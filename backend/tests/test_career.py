import json
import asyncio
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import httpx
import pytest

from backend.tests.test_workspace import client_for, create_source, select_role


def test_new_answer_changes_career_recommendation_and_survives_restart(tmp_path):
    correct = False

    def respond(request):
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        answer = payload["answer"]
        evaluation = {"topic": "RAG", "strengths": [], "weaknesses": [], "unverified": [],
                      "followup_point": "", "recommended_action": "complete" if correct else "review"}
        item = {"point": "检索评估", "evidence": answer}
        if correct:
            evaluation["strengths"].append(item)
        else:
            evaluation["weaknesses"].append({**item, "type": "incorrect"})
        value = {"feedback": "有依据的测试点评", "follow_up": "", "focus": "检索评估", "evidence": answer,
                 "next_step": "对照标注集检查召回结果", "evaluation": evaluation}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]})

    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        source_id = create_source(client, question="RAG 检索评估怎么做？")
        first = client.get("/api/workspace").json()["sources"][0]["questions"][0]
        client.put(f'/api/sources/{source_id}/questions/{first["id"]}/topic', json={"topic": "RAG"})
        second = client.post(f"/api/sources/{source_id}/questions", json={"text": "RAG 的 Chunk 如何切分？", "topic": "RAG"}).json()
        request = {"role": "Python 开发工程师", "topics": ["RAG"]}
        assert client.post("/api/career/plan", json=request).json()["tasks"][0]["action"] == "practice"
        for _ in range(2):
            result = client.post("/api/practice/dialogue/turn", json={"role": request["role"], "question": first["text"],
                "answer": "RAG 召回越多答案一定越准", "question_ref": {"kind": "source", "id": first["id"]}, "request_id": str(uuid4())})
            assert result.status_code == 200
        plan = client.post("/api/career/plan", json=request).json()
        assert plan["tasks"][0]["action"] == "review"
        assert plan["tasks"][0]["question"]["question_ref"]["id"] == first["id"]
        assert len(plan["tasks"][0]["evidence"]) == 2
        correct = True
        for _ in range(2):
            assert client.post("/api/practice/dialogue/turn", json={"role": request["role"], "question": first["text"],
                "answer": "RAG 用标注集评估 Recall@k 和 nDCG", "question_ref": {"kind": "source", "id": first["id"]}, "request_id": str(uuid4())}).status_code == 200
        plan = client.post("/api/career/plan", json=request).json()
        assert plan["tasks"][0]["action"] == "practice"
        assert plan["tasks"][0]["question"]["question_ref"]["id"] == second["id"]
        point = plan["profile"]["points"][0]
        assert point["change"] == "improving"
        assert point["supporting_sessions"] == 2
    with client_for(tmp_path) as client:
        history = client.get("/api/career/ability-history", params={"role": "Python 开发工程师"}).json()
        assert len(history["history"]) == 4
        assert history["profile"]["points"][0]["supporting_sessions"] == 2


def test_research_training_task_closes_loop_and_restores_after_restart(tmp_path):
    calls = []
    question = "RAG 检索质量怎么评估？"

    def respond(request):
        calls.append(request.url.host)
        if request.url.host == "api.tavily.com":
            return httpx.Response(200, json={"results": [{"title": "Python 开发工程师一面面经", "url": "https://www.cnblogs.com/test/p/123.html"}]})
        if request.url.host == "www.cnblogs.com":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=f'<div id="cnblogs_post_body"><h2>Python 开发工程师一面面经</h2><p>我参加了一面。</p><p>面试官问：{question}</p></div>')
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        if "answer" not in payload:
            value = {"items": [{"question": question, "evidence": "面试官问：" + question}]}
        else:
            value = {"feedback": "测试点评", "follow_up": "", "focus": "检索评估", "evidence": payload["answer"], "next_step": "检查标注集",
                "evaluation": {"topic": "RAG", "strengths": [{"point": "检索评估", "evidence": payload["answer"]}],
                    "weaknesses": [], "unverified": [], "followup_point": "", "recommended_action": "complete"}}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]})

    services = {"TAVILY_API_KEY": "test", "AI_API_KEY": "test", "AI_MODEL": "test"}
    with client_for(tmp_path, services=services, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        role = "Python 开发工程师"
        request = {"role": role, "topic": "RAG", "request_id": str(uuid4())}
        created = client.post("/api/training/tasks/create", json=request)
        assert created.status_code == 200
        task = created.json()["task"]
        assert client.post("/api/training/tasks/create", json=request).json()["task"]["id"] == task["id"]
        result = client.post("/api/research", json={"role": role, "task_id": task["id"], "range": "all", "confirm": True})
        assert result.status_code == 200
        candidate = result.json()["candidates"][0]
        # A pending, evidence-backed review must survive backup restoration without
        # becoming an already-confirmed question.
        review_backup = client.get('/api/export').json()
        with client_for(tmp_path / 'restored-review') as restored_client:
            assert restored_client.post('/api/import', json={'mode': 'merge', 'data': review_backup}).status_code == 200
            select_role(restored_client)
            reviewed = restored_client.get('/api/training/tasks', params={'role': role, 'id': task['id']}).json()['task']
            assert reviewed['status'] == 'review'
            assert reviewed['candidate_id'] is None
            assert restored_client.get('/api/workspace').json()['sources'] == []
            assert restored_client.post('/api/research/confirm', json={'role': role, 'task_id': task['id'], 'id': candidate['id'], 'self_reported': True}).status_code == 201
        assert client.get("/api/workspace").json()["sources"] == []
        count = len(calls)
        assert client.post("/api/research", json={"role": role, "task_id": task["id"], "confirm": True}).status_code == 200
        assert len(calls) == count
        body = {"role": role, "task_id": task["id"], "id": candidate["id"]}
        assert client.post("/api/research/confirm", json=body).status_code == 400
        confirmation = client.post("/api/research/confirm", json={**body, "self_reported": True})
        assert confirmation.status_code == 201
        record = confirmation.json()
        assert client.post("/api/research/confirm", json={**body, "self_reported": True}).json() == record
        attempt = client.post("/api/practice/dialogue/turn", json={"role": role, "question": question,
            "answer": "RAG 通过标注集评估召回和排序", "request_id": str(uuid4()), "question_ref": {"kind": "source", "id": record["id"]}})
        assert attempt.status_code == 200
        restored = client.get("/api/training/tasks", params={"role": role, "id": task["id"]}).json()["task"]
        assert restored["status"] == "completed"
        assert restored["attempt_id"] == attempt.json()["id"]
        completed_backup = client.get('/api/export').json()
    with client_for(tmp_path) as client:
        restored = client.get("/api/training/tasks", params={"role": role, "id": task["id"]}).json()["task"]
        assert restored["status"] == "completed"
        assert restored["question"]["id"] == record["id"]
    with client_for(tmp_path / 'restored-completed') as client:
        assert client.post('/api/import', json={'mode': 'merge', 'data': completed_backup}).status_code == 200
        select_role(client)
        restored = client.get('/api/training/tasks', params={'role': role, 'id': task['id']}).json()['task']
        assert restored['status'] == 'completed'
        assert client.get('/api/career/ability-history', params={'role': role}).json()['history'][0]['attempt_id'] == attempt.json()['id']


@pytest.mark.parametrize("failure,reason", [("empty", "no_results"), ("evidence", "insufficient_evidence"), ("model", "model_failed")])
def test_training_search_failure_is_persisted_without_questions(tmp_path, failure, reason):
    def respond(request):
        if request.url.host == "api.tavily.com":
            rows = [] if failure == "empty" else [{"title": "Python 开发一面面经", "url": "https://www.cnblogs.com/test/p/123.html"}]
            return httpx.Response(200, json={"results": rows})
        if request.url.host == "www.cnblogs.com":
            return httpx.Response(200, headers={"content-type": "text/html"}, text='<div id="cnblogs_post_body"><p>面试官问：RAG 是什么？</p></div>')
        if failure == "model":
            return httpx.Response(503)
        content = json.dumps({"items": [{"question": "RAG 评估怎么做？", "evidence": "正文中不存在的题目"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    with client_for(tmp_path, services={"TAVILY_API_KEY": "test", "AI_API_KEY": "test", "AI_MODEL": "test"},
                    http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        role = "Python 开发工程师"
        task = client.post("/api/training/tasks/create", json={"role": role, "topic": "RAG", "request_id": str(uuid4())}).json()["task"]
        result = client.post("/api/research", json={"role": role, "task_id": task["id"], "range": "all", "confirm": True})
        assert result.status_code == 200
        assert result.json()["task_status"] == "failed"
        assert result.json()["task_reason"] == reason
        assert client.get("/api/workspace").json()["sources"] == []


def test_training_task_cancellation_and_restart_timeout(tmp_path):
    role = "Python 开发工程师"
    with client_for(tmp_path) as client:
        select_role(client)
        create = {"role": role, "topic": "RAG", "request_id": str(uuid4())}
        task = client.post("/api/training/tasks/create", json=create).json()["task"]
        assert client.post("/api/training/tasks/cancel", json={"role": role, "id": task["id"]}).json()["task"]["status"] == "cancelled"
        other = client.post("/api/training/tasks/create", json={**create, "request_id": str(uuid4())}).json()["task"]
        assert other["id"] != task["id"]
    with sqlite3.connect(tmp_path / "interview.sqlite") as db:
        db.execute("UPDATE training_tasks SET status='searching',started_at=1 WHERE id=?", (other["id"],))
    with client_for(tmp_path) as client:
        result = client.get("/api/training/tasks", params={"role": role, "id": other["id"]}).json()["task"]
        assert result["status"] == "failed"
        assert result["reason"] == "timeout"
        select_role(client, "其他岗位")
        assert client.get("/api/training/tasks", params={"role": "其他岗位", "id": other["id"]}).status_code == 400


def test_cancelling_running_research_stops_the_active_call(tmp_path):
    started = threading.Event()

    async def respond(request):
        started.set()
        await asyncio.sleep(5)
        return httpx.Response(200, json={"results": []})

    with client_for(tmp_path, services={"TAVILY_API_KEY": "test"}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        role = "Python 开发工程师"
        task = client.post("/api/training/tasks/create", json={"role": role, "topic": "RAG", "request_id": str(uuid4())}).json()["task"]
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(client.post, "/api/research", json={"role": role, "task_id": task["id"], "confirm": True})
            assert started.wait(2)
            cancelled = client.post("/api/training/tasks/cancel", json={"role": role, "id": task["id"]})
            assert cancelled.json()["task"]["status"] == "cancelled"
            assert pending.result(timeout=2).status_code == 409
        assert client.get("/api/training/tasks", params={"role": role, "id": task["id"]}).json()["task"]["result"] is None


def test_explicit_knowledge_aliases_merge_without_merging_other_topics(tmp_path):
    descriptions = iter([("RAG", "检索质量评估"), ("检索增强生成", "retrieval evaluation"), ("SQL", "检索质量评估")])

    def respond(request):
        topic, point = next(descriptions)
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        value = {"feedback": "测试正确表现", "follow_up": "", "focus": point, "evidence": payload["answer"], "next_step": "下一题",
            "evaluation": {"topic": topic, "strengths": [{"point": point, "evidence": payload["answer"]}], "weaknesses": [],
                "unverified": [], "followup_point": "", "recommended_action": "complete"}}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]})

    with client_for(tmp_path, services={"AI_API_KEY": "test", "AI_MODEL": "test"}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        for question in ("RAG 检索质量怎么评估？", "检索增强生成的检索质量怎么评估？", "SQL 检索质量怎么评估？"):
            assert client.post("/api/practice/dialogue/turn", json={"role": "Python 开发工程师", "question": question,
                "answer": "使用标注集评估相关性", "request_id": str(uuid4())}).status_code == 200
        profile = client.get("/api/career/ability-history", params={"role": "Python 开发工程师"}).json()["profile"]
        assert len(profile["points"]) == 2
        assert sorted(point["correct"] for point in profile["points"]) == [1, 2]
