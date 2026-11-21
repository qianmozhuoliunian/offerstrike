import json
from datetime import datetime, timezone

import httpx
import pytest

from backend.research.source import article_url, read_article
from backend.research.verification import verify_candidates
from backend.tests.test_workspace import client_for, select_role


def sample(*, company="远帆科技", paragraph="我在远帆科技面试后端开发。", quote="远帆科技 后端开发 一面"):
    heading = quote
    question = "面试官问：如何评估检索质量？"
    text = f"{heading}\n\n{paragraph}\n\n{question}"
    return {
        "body": {"text": text, "title": quote, "headings": [{"text": heading, "start": 0, "level": 2}]},
        "content": json.dumps({"items": [{"evidence": question, "role_evidence": heading,
                                         "company_evidence": heading, "report_evidence": question}]}),
        "role": "后端开发", "company": company,
    }


def test_attribution_requires_affirmative_company_in_question_section():
    data = sample()
    items = verify_candidates(data["content"], data["body"], role=data["role"], company=data["company"])
    assert len(items) == 1
    assert items[0]["question"] == "如何评估检索质量？"
    assert items[0]["company_evidence"] == "远帆科技 后端开发 一面"


@pytest.mark.parametrize("paragraph", [
    "不是远帆科技，我面试的公司是另一家公司。",
    "我没有去远帆科技面试。", "这篇是转载他人面经。",
    "我的朋友在远帆科技面试后端开发。",
])
def test_negative_and_third_party_company_never_become_candidates(paragraph):
    data = sample(paragraph=paragraph)
    assert verify_candidates(data["content"], data["body"], role=data["role"], company=data["company"]) == []


def test_cross_section_evidence_and_answer_text_are_rejected():
    data = sample()
    body = data["body"]
    earlier = "远帆科技 后端开发 一面\n\n我参加了面试。\n\n"
    current = "别家公司 后端开发 二面\n\n面试官问：如何评估检索质量？"
    body["text"] = earlier + current
    body["headings"].append({"text": "别家公司 后端开发 二面", "start": len(earlier), "level": 2})
    assert verify_candidates(data["content"], body, role=data["role"], company=data["company"]) == []


def test_source_reader_urls_are_fixed_and_public():
    assert article_url("https://m.nowcoder.com/discuss/930603646885122048?x=1") == "https://www.nowcoder.com/discuss/930603646885122048"
    assert article_url("https://www.cnblogs.com/author/p/123.html") == "https://www.cnblogs.com/author/p/123.html"
    for url in ("http://www.nowcoder.com/discuss/930603646885122048", "https://x@www.cnblogs.com/a/p/1.html",
                "https://127.0.0.1/a/p/1.html", "https://www.nowcoder.com/experience/123"):
        assert article_url(url) is None


@pytest.mark.anyio
async def test_nowcoder_reader_verifies_id_and_ignores_metadata():
    value = {"success": True, "data": {"id": "930603646885122048", "title": "后端一面",
             "createTime": 1761955200000, "richText": "<h2>远帆科技</h2><p>面试官问：如何评估检索质量？</p><script>invalid</script>"}}
    calls = []

    def respond(request):
        calls.append(str(request.url))
        return httpx.Response(200, json=value)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        body = await read_article(client, "https://www.nowcoder.com/discuss/930603646885122048")
        assert body["date"] == "2025-11-01"
        assert "invalid" not in body["text"]
        assert body["headings"][0]["text"] == "远帆科技"
        assert calls == ["https://gw-c.nowcoder.com/api/sparta/detail/content-data/detail/930603646885122048"]
        value["data"]["id"] = "wrong"
        with pytest.raises(ValueError, match="source_unavailable"):
            await read_article(client, "https://www.nowcoder.com/discuss/930603646885122048")


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_research_http_flow_requires_confirmation_and_saves_evidence_once(tmp_path):
    calls = []
    question = "面试官问：如何评估检索质量？"
    title = "远帆科技 后端开发 一面"

    def respond(request):
        calls.append(str(request.url))
        if request.url.host == "api.tavily.com":
            return httpx.Response(200, json={"results": [{"title": title,
                "url": "https://www.cnblogs.com/test/p/123.html", "published_date": "2026-11-01", "content": "公开测试线索"}]})
        if request.url.host == "www.cnblogs.com":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=f'<meta property="article:published_time" content="2026-11-01"><div id="cnblogs_post_body"><h2>{title}</h2><p>我在远帆科技面试后端开发。</p><p>{question}</p></div>')
        if request.url.host == "api.deepseek.com":
            payload = json.loads(request.content)
            assert payload["thinking"] == {"type": "disabled"}
            content = json.dumps({"items": [{"question": "如何评估检索质量？", "evidence": question,
                                             "role_evidence": title, "company_evidence": title, "report_evidence": question}]})
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
                                          "usage": {"prompt_tokens": 100, "completion_tokens": 60}})
        raise AssertionError(f"Unexpected destination {request.url.host}")

    services = {"TAVILY_API_KEY": "test-search", "AI_API_KEY": "test-model", "AI_MODEL": "test",
                "AI_BASE_URL": "https://api.deepseek.com"}
    with client_for(tmp_path, services=services, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client, "后端开发")
        body = {"role": "后端开发", "company": "远帆科技", "range": "all", "topics": ["检索质量"]}
        assert client.post("/api/research", json=body).status_code == 400
        response = client.post("/api/research", json={**body, "confirm": True})
        assert response.status_code == 200
        result = response.json()
        assert result["usage"]["search"] == 1
        assert result["usage"]["read"] == 1
        assert result["usage"]["model"] == 1
        assert len(result["candidates"]) == 1
        assert client.get("/api/workspace").json()["sources"] == []
        candidate = result["candidates"][0]
        confirmation = {"role": "后端开发", "id": candidate["id"], "self_reported": True}
        first = client.post("/api/research/confirm", json=confirmation)
        assert first.status_code == 201
        assert client.post("/api/research/confirm", json=confirmation).json() == first.json()
        source = client.get("/api/workspace").json()["sources"][0]
        assert source["questions"][0]["evidence"] == question
        assert source["questions"][0]["topic"] == "检索质量"
        assert len(source["questions"]) == 1
        select_role(client, "其他岗位")
        assert client.post("/api/research/confirm", json=confirmation).status_code == 400
    assert len(calls) == 3


def test_failed_search_provider_has_safe_failure_and_no_saved_data(tmp_path):
    with client_for(tmp_path, services={"TAVILY_API_KEY": "test-search"},
                    http_transport=httpx.MockTransport(lambda request: httpx.Response(500))) as client:
        select_role(client)
        response = client.post("/api/search", json={"role": "Python 开发工程师", "range": "all"})
        assert response.status_code == 502
        assert "test-search" not in response.text
        assert client.get("/api/workspace").json()["sources"] == []


def test_research_with_no_model_reads_nothing_and_reports_missing_configuration(tmp_path):
    def respond(request):
        assert request.url.host == "api.tavily.com"
        return httpx.Response(200, json={"results": [{"title": "Python 开发工程师一面",
             "url": "https://www.cnblogs.com/a/p/123.html", "published_date": "2026-11-01"}]})

    with client_for(tmp_path, services={"TAVILY_API_KEY": "test-search"}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        response = client.post("/api/research", json={"role": "Python 开发工程师", "confirm": True, "range": "all"})
        assert response.status_code == 200
        assert response.json()["stop"] == "model_unavailable"
        assert response.json()["usage"]["read"] == 0
        assert response.json()["candidates"] == []


def test_pasted_extraction_and_jd_require_literal_evidence(tmp_path):
    source_text = "面试官问：如何定位慢查询？"

    def respond(request):
        payload = json.loads(request.content)
        if "岗位职责" in payload["messages"][0]["content"]:
            content = json.dumps({"status": "ok", "items": [{"requirement": "Python 开发", "evidence": "Python 开发"}]})
        else:
            content = json.dumps({"items": [
                {"question": "如何定位慢查询？", "evidence": source_text},
                {"question": "编造问题？", "evidence": "正文不存在的片段"},
            ]})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"},
                    http_transport=httpx.MockTransport(respond)) as client:
        source = client.post("/api/sources", json={"title": "粘贴测试", "url": "https://example.com", "role": "测试岗位"}).json()["id"]
        base = f"/api/sources/{source}"
        result = client.post(f"{base}/extract-questions", json={"source_text": source_text}).json()
        assert result["omitted"] == 1
        assert len(result["items"]) == 1
        assert client.get("/api/workspace").json()["sources"][0]["questions"] == []
        candidate = result["items"][0]
        body = {"source_text": source_text, "text": candidate["question"], "evidence": candidate["evidence"],
                "request_id": candidate["id"], "expected_source": {"role": "测试岗位", "url": "https://example.com"}}
        assert client.post(f"{base}/extracted-questions", json={**body, "evidence": "错误依据片段"}).status_code == 400
        assert client.post(f"{base}/extracted-questions", json=body).status_code == 201
        assert client.post(f"{base}/extracted-questions", json=body).status_code == 200
        assert len(client.get("/api/workspace").json()["sources"][0]["questions"]) == 1
        assert client.post("/api/jd/parse", json={"jd": "需要 Python 开发"}).json()["requirements"] == "Python 开发"
        assert client.post("/api/jd/parse", json={"jd": "需要 Java 开发"}).status_code == 400


def test_search_date_filter_and_provider_fallback_preserve_scope(tmp_path):
    requests = []

    def respond(request):
        payload = json.loads(request.content)
        requests.append((request.url.host, payload))
        if request.url.host == "api.tavily.com":
            return httpx.Response(503)
        return httpx.Response(200, json={"results": [
            {"title": "Python 开发一面", "url": "https://www.nowcoder.com/discuss/930603646885122048", "publishedDate": datetime.now(timezone.utc).date().isoformat()},
            {"title": "Python 开发一面", "url": "https://www.nowcoder.com/discuss/930603646885122049", "publishedDate": "2000-01-01"},
        ]})

    with client_for(tmp_path, services={"TAVILY_API_KEY": "test", "EXA_API_KEY": "test"},
                    http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        response = client.post("/api/search", json={"role": "Python 开发工程师", "source": "nowcoder", "range": "year"})
        result = response.json()
        assert response.status_code == 200
        assert result["retrieval"]["requests"] == 3
        assert result["retrieval"]["fallback_reason"] == "unavailable"
        assert result["partial_failure"] is True
        assert len(result["results"]) == 1
    assert all(payload.get("include_domains", payload.get("includeDomains")) == ["nowcoder.com"] for _, payload in requests)


@pytest.mark.parametrize("index,company_in_title,expected", [(0, True, "related"), (99, True, "uncertain"), (0, False, "uncertain")])
def test_search_ai_relevance_requires_correct_index_and_title_company_evidence(tmp_path, index, company_in_title, expected):
    title = "远帆科技 Python 开发一面" if company_in_title else "Python 开发一面"

    def respond(request):
        if request.url.host == "api.tavily.com":
            return httpx.Response(200, json={"results": [{"title": title, "content": "远帆科技面试", "url": "https://www.nowcoder.com/discuss/930603646885122048"}]})
        content = json.dumps({"items": [{"index": index, "status": "related", "role_evidence": "Python",
            "company_evidence": "远帆科技", "interview_evidence": "一面"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    with client_for(tmp_path, services={"TAVILY_API_KEY": "test", "AI_API_KEY": "test", "AI_MODEL": "test"},
                    http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        response = client.post("/api/search", json={"role": "Python 开发工程师", "company": "远帆科技", "range": "all", "ai_relevance": True})
        assert response.status_code == 200
        data = response.json()
        items = data["results"] + data["supplementary_results"] + data["unverified_results"]
        assert len(items) == 1
        assert items[0]["ai_relevance"] == expected
