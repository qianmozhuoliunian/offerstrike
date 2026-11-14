import json

import httpx
import pytest
from fastapi.testclient import TestClient

from research_service.main import create_app

QUERY = dict(provider="Tavily", role="产品经理", company="示例公司",
             domains=["nowcoder.com"], phrase="面经",
             from_date="2025-01-01", through_date="2025-12-31")
TOKEN = "a" * 64
AUTH = {"x-offerpilot-retrieval": TOKEN}


@pytest.mark.parametrize("provider,phrase", [("Tavily", "面经"), ("Exa", "面试经历")])
def test_retrieval_uses_provider_credentials_and_preserves_scope(provider, phrase):
    def upstream(request):
        payload = json.loads(request.content)
        assert payload["query"] == f"产品经理 示例公司 {phrase}"
        if provider == "Tavily":
            assert request.url == "https://api.tavily.com/search"
            assert request.headers["authorization"] == "Bearer mock-key"
            assert payload["include_domains"] == ["nowcoder.com"]
            assert payload["start_date"] == "2025-01-01"
            excerpt = dict(content="摘录", published_date="2025-06-01")
        else:
            assert request.url == "https://api.exa.ai/search"
            assert request.headers["x-api-key"] == "mock-key"
            assert payload["includeDomains"] == ["nowcoder.com"]
            assert payload["startPublishedDate"] == "2025-01-01T00:00:00.000Z"
            assert payload["endPublishedDate"] == "2025-12-31T23:59:59.999Z"
            excerpt = dict(highlights=["摘录"], publishedDate="2025-06-01")
        return httpx.Response(200, json={"results": [
            None, dict(title="面经", url="https://www.nowcoder.com/discuss/1", **excerpt)]})

    with TestClient(create_app(transport=httpx.MockTransport(upstream), keys={provider: "mock-key"}, token=TOKEN),
                    base_url="http://127.0.0.1", headers=AUTH) as client:
        assert client.get("/health").json() == {"providers": [provider]}
        result = client.post("/v1/retrieve", json={**QUERY, "provider": provider, "phrase": phrase})
        assert result.status_code == 200
        assert result.json()["results"] == [
            dict(title="面经", url="https://www.nowcoder.com/discuss/1", snippet="摘录", published_date="2025-06-01")]


@pytest.mark.parametrize("extra", [
    {"domains": ["example.com"]}, {"role": "   "}, {"provider": "Other"}, {"phrase": "面试经历"},
    {"jd": "私人内容"}, {"from_date": "2025-12-31", "through_date": "2025-01-01"},
    {"through_date": "2099-01-01"}, {"from_date": None},
])
def test_rejects_invalid_or_unexpected_input_without_upstream(extra):
    def upstream(_):
        pytest.fail("invalid input was sent upstream")

    with TestClient(create_app(transport=httpx.MockTransport(upstream), keys={"Tavily": "mock"}, token=TOKEN),
                    base_url="http://127.0.0.1", headers=AUTH) as client:
        invalid = client.post("/v1/retrieve", json={**QUERY, **extra})
        assert invalid.status_code == 422
        assert "私人内容" not in invalid.text
        assert client.post("/v1/retrieve", headers={"Host": "example.com"}, json=QUERY).status_code == 400


@pytest.mark.parametrize("mode,status", [("missing", 503), ("upstream", 502), ("format", 502), ("timeout", 504)])
def test_reports_provider_errors_without_exposing_credentials(mode, status):
    def upstream(request):
        if mode == "missing":
            pytest.fail("missing credential led to an upstream request")
        if mode == "timeout":
            raise httpx.ReadTimeout("private-key", request=request)
        return httpx.Response(503, text="private-key") if mode == "upstream" else httpx.Response(200, json={})

    with TestClient(create_app(transport=httpx.MockTransport(upstream),
                               keys={} if mode == "missing" else {"Tavily": "private-key"}, token=TOKEN),
                    base_url="http://127.0.0.1", headers=AUTH) as client:
        response = client.post("/v1/retrieve", json=QUERY)
        assert response.status_code == status
        assert "private-key" not in response.text


@pytest.mark.parametrize("token,received,status", [("", "", 503), (TOKEN, "", 401), (TOKEN, "wrong", 401)])
def test_requires_configured_local_access_token(token, received, status):
    def upstream(_):
        pytest.fail("unauthorized request reached upstream")

    with TestClient(create_app(transport=httpx.MockTransport(upstream), keys={"Tavily": "mock"}, token=token),
                    base_url="http://127.0.0.1") as client:
        response = client.post("/v1/retrieve", json=QUERY, headers={"x-offerpilot-retrieval": received})
        assert response.status_code == status
        assert TOKEN not in response.text
