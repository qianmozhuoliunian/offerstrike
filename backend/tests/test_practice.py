import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import httpx

from backend.tests.test_workspace import client_for, create_source, select_role


def review_response(answer):
    return {"feedback": "你提到了召回数量，需要区分召回与答案质量。", "follow_up": "如何验证检索文档是否相关？",
            "focus": "检索质量评估", "evidence": answer, "next_step": "构建小规模相关性标注集",
            "evaluation": {"topic": "RAG", "strengths": [],
                "weaknesses": [{"point": "召回数量与答案质量", "evidence": answer, "type": "incorrect"}],
                "unverified": ["相关性标注集"], "followup_point": "召回数量与答案质量", "recommended_action": "followup"}}


def test_dialogue_evaluation_persistence_followup_and_summary(tmp_path):
    answer = "RAG 检索越多答案就一定越准确"
    calls = []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        question = payload["messages"][0]["content"]
        if '"summary"' in question:
            content = json.dumps({"summary": "本轮需要进一步区分召回数量和检索相关性。"})
        else:
            content = json.dumps(review_response(answer))
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    services = {"AI_API_KEY": "test", "AI_MODEL": "test"}
    with client_for(tmp_path, services=services, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        source = create_source(client, question="RAG 检索质量如何评估？")
        question = client.get("/api/workspace").json()["sources"][0]["questions"][0]
        body = {"role": "Python 开发工程师", "question": question["text"], "answer": answer,
                "request_id": str(uuid4()), "question_ref": {"kind": "source", "id": question["id"]}}
        response = client.post("/api/practice/dialogue/turn", json=body)
        assert response.status_code == 200
        result = response.json()
        assert result["evaluation"]["weaknesses"][0]["evidence"] == answer
        assert result["follow_up"] == "如何验证检索文档是否相关？"
        assert client.post("/api/practice/dialogue/turn", json=body).json()["id"] == result["id"]
        assert len(calls) == 1
        dialogue = client.get(f'/api/practice/dialogue/{result["id"]}', params={"role": body["role"]}).json()
        assert dialogue["can_continue"] is True
        assert dialogue["source_available"] is True
        summary = client.post("/api/practice/dialogue/summary", json={"role": body["role"], "attempt_id": result["id"]})
        assert summary.status_code == 200
        assert client.get(f'/api/practice/dialogue/{result["id"]}', params={"role": body["role"]}).json()["can_continue"] is False
        attempt_id = result["id"]
    with client_for(tmp_path) as client:
        dialogue = client.get(f"/api/practice/dialogue/{attempt_id}", params={"role": "Python 开发工程师"}).json()
        assert dialogue["turns"][0]["evaluation"]["topic"] == "RAG"
        assert dialogue["summary"] == "本轮需要进一步区分召回数量和检索相关性。"


def test_offline_save_draft_and_assessment_are_compatible_and_idempotent(tmp_path):
    with client_for(tmp_path) as client:
        select_role(client)
        draft = {"role": "Python 开发工程师", "question": "如何定位慢查询？", "answer": "先看查询计划"}
        assert client.put("/api/draft", json=draft).status_code == 200
        assert client.get("/api/practice/history", params={"role": draft["role"]}).json()["draft"]["answer"] == "先看查询计划"
        body = {**draft, "request_id": str(uuid4())}
        response = client.post("/api/practice/local", json=body)
        assert response.status_code == 201
        assert client.post("/api/practice/local", json=body).json()["reused"] is True
        assert client.post("/api/practice/local", json={**body, "answer": "改变内容"}).status_code == 400
        attempt_id = response.json()["id"]
        assert client.put(f"/api/attempts/{attempt_id}/assessment", json={"rating": "revisit"}).status_code == 200
        assert client.post(f"/api/practice/local/{attempt_id}/feedback", json={"role": draft["role"]}).status_code == 503
    with client_for(tmp_path) as client:
        history = client.get("/api/practice/history", params={"role": draft["role"]}).json()
        assert history["attempts"][0]["answer"] == "先看查询计划"
        assert history["attempts"][0]["rating"] == "revisit"
        assert history["draft"]["question"] == draft["question"]
        assert client.get(f"/api/practice/dialogue/{attempt_id}", params={"role": draft["role"]}).json()["turns"][0]["answer"] == "先看查询计划"


def test_invalid_structured_evidence_degrades_to_feedback(tmp_path):
    answer = "RAG 先检索文档再生成回答"
    value = review_response(answer)
    value["evaluation"]["weaknesses"][0]["evidence"] = "回答里不存在的证据"
    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"},
                    http_transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]}))) as client:
        select_role(client)
        result = client.post("/api/practice/dialogue/turn", json={"role": "Python 开发工程师", "question": "请解释 RAG", "answer": answer}).json()
        assert result["feedback"]
        assert result["evaluation"] is None
        assert client.get("/api/practice/history", params={"role": "Python 开发工程师"}).json()["attempts"][0]["feedback"] == result["feedback"]


def test_omission_requires_question_evidence_and_unverified_is_preserved(tmp_path):
    answer = "RAG 先检索文档"
    value = review_response(answer)
    value["evaluation"]["weaknesses"] = [{"point": "评估指标", "evidence": answer, "type": "missing", "requirement": "说明如何评估"}]
    value["evaluation"]["followup_point"] = "评估指标"
    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"},
                    http_transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]}))) as client:
        select_role(client)
        result = client.post("/api/practice/dialogue/turn", json={"role": "Python 开发工程师", "question": "请解释 RAG 并说明如何评估", "answer": answer}).json()
        assert result["evaluation"]["weaknesses"][0]["type"] == "missing"
        assert result["evaluation"]["unverified"] == ["相关性标注集"]
        result = client.post("/api/practice/dialogue/turn", json={"role": "Python 开发工程师", "question": "请解释 RAG", "answer": answer}).json()
        assert result["evaluation"] is None


def test_dialogue_stops_after_eight_turns(tmp_path):
    def respond(request):
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        value = review_response(payload["answer"])
        value["follow_up"] = f'检索第 {len(payload["previous_turns"]) + 1} 步如何处理？'
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]})

    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        parent = ""
        question = "请解释 RAG"
        for index in range(8):
            response = client.post("/api/practice/dialogue/turn", json={"role": "Python 开发工程师", "question": question,
                "answer": f"RAG 回答 {index}", "parent_attempt_id": parent, "request_id": str(uuid4())})
            assert response.status_code == 200
            result = response.json()
            parent, question = result["id"], result["follow_up"]
        assert question == ""
        dialogue = client.get(f"/api/practice/dialogue/{parent}", params={"role": "Python 开发工程师"}).json()
        assert len(dialogue["turns"]) == 8
        assert dialogue["can_continue"] is False
        assert result["evaluation"]["recommended_action"] == "review"


def test_concurrent_duplicate_answer_uses_one_model_call(tmp_path):
    calls = []

    async def respond(request):
        calls.append(1)
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(review_response("RAG 回答"))}}]})

    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        body = {"role": "Python 开发工程师", "question": "请解释 RAG", "answer": "RAG 回答", "request_id": str(uuid4())}
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: client.post("/api/practice/dialogue/turn", json=body), range(2)))
        assert all(response.status_code == 200 for response in results)
        assert results[0].json()["id"] == results[1].json()["id"]
        assert len(calls) == 1
