import json
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


TOKEN = "a" * 64
HEADERS = {"x-offerpilot-access": TOKEN}


def client_for(directory, **kwargs):
    return TestClient(
        create_app(data_dir=directory, token=TOKEN, port=8765, **kwargs),
        base_url="http://127.0.0.1:8765",
        headers=HEADERS,
    )


def test_desktop_uses_its_private_header_for_static_and_api(tmp_path):
    frontend = tmp_path / 'frontend'
    frontend.mkdir()
    (frontend / 'index.html').write_text('<main>Vue fixture</main>')
    with client_for(tmp_path / 'db', frontend_dir=frontend, desktop=True) as client:
        assert client.get('/').status_code == 401
        assert client.get('/api/workspace').status_code == 401
        headers = {'x-interview-desktop': TOKEN}
        assert client.get('/', headers=headers).status_code == 200
        assert client.get('/api/workspace', headers=headers).status_code == 200
        assert client.get('/api/workspace', headers={**headers, 'origin': 'https://example.com'}).status_code == 403


def select_role(client, role="Python 开发工程师"):
    response = client.post("/api/role", json={"role": role})
    assert response.status_code == 200
    result = response.json()
    if result["status"] == "needs_confirmation":
        response = client.post("/api/role", json={
            "role": role, "confirmation_token": result["confirmation_token"],
        })
    assert response.json() == {"role": role, "status": "saved"}


def test_role_profile_and_source_survive_restart(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/api/workspace").json()["role"] == ""
        select_role(client)
        assert client.post("/api/jd", json={
            "role": "Python 开发工程师", "jd": "Python 与 SQL",
            "confirmed_requirements": "能分析 SQL 查询计划",
        }).status_code == 200
        response = client.post("/api/sources", json={
            "title": "面试记录", "url": "https://example.com/interview",
            "type": "真实面经（自述）", "role": "Python 开发工程师",
            "question": "如何定位慢查询？",
        })
        assert response.status_code == 201
        source_id = response.json()["id"]
    with client_for(tmp_path) as restarted:
        state = restarted.get("/api/workspace").json()
        assert state["role"] == "Python 开发工程师"
        assert state["roleValidation"] == "confirmed"
        assert state["confirmed_requirements"] == "能分析 SQL 查询计划"
        assert state["sources"][0]["id"] == source_id
        assert state["sources"][0]["questions"][0]["text"] == "如何定位慢查询？"
        assert state["sources"][0]["legacy_question"] == ""


def create_source(client, **changes):
    response = client.post("/api/sources", json={
        "title": "合成测试来源", "url": "https://example.com/post",
        "role": "Python 开发工程师", **changes,
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_question_library_edits_and_removal(tmp_path):
    with client_for(tmp_path) as client:
        source = create_source(client)
        base = f"/api/sources/{source}"
        result = client.post(f"{base}/questions", json={"text": "如何评估召回？", "topic": "RAG"})
        assert result.status_code == 201
        question = result.json()["id"]
        path = f"{base}/questions/{question}"
        assert client.put(path, json={"text": "如何评估检索？", "topic": "检索评估", "note": "查询级评估"}).status_code == 200
        assert client.put(f"{base}/interview-date", json={"interview_date": "2026-11-19"}).status_code == 200
        item = client.get("/api/workspace").json()["sources"][0]
        assert item["interview_date"] == "2026-11-19"
        assert item["questions"][0]["text"] == "如何评估检索？"
        assert item["questions"][0]["topic"] == "检索评估"
        assert item["questions"][0]["note"] == "查询级评估"
        # Old callers editing only the text preserve topic and notes.
        assert client.put(path, json={"text": "检索质量如何度量？"}).status_code == 200
        assert client.get("/api/workspace").json()["sources"][0]["questions"][0]["topic"] == "检索评估"
        assert client.put(f"{path}/topic", json={"topic": ""}).status_code == 200
        assert client.put(f"{path}/note", json={"note": "单独更新"}).status_code == 200
        assert client.delete(path).status_code == 200
        assert client.get("/api/workspace").json()["sources"][0]["questions"] == []
        assert client.delete(base).status_code == 200
        assert client.get("/api/workspace").json()["sources"] == []


@pytest.mark.parametrize("changes", [
    {"title": " "}, {"url": "javascript:alert(1)"}, {"url": "https://"},
    {"date": "2026-02-30"}, {"interview_date": "2026-2-1"},
    {"question": "q" * 10001}, {"role": "x" * 101},
])
def test_invalid_source_leaves_no_partial_records(tmp_path, changes):
    with client_for(tmp_path) as client:
        response = client.post("/api/sources", json={"title": "测试", "url": "https://example.com", **changes})
        assert response.status_code in {400, 422}
        assert client.get("/api/workspace").json()["sources"] == []


def test_role_confirmation_binding_and_profile_isolation(tmp_path):
    with client_for(tmp_path) as client:
        result = client.post("/api/role", json={"role": "新岗位"}).json()
        assert client.post("/api/role", json={"role": "另一个岗位", "confirmation_token": result["confirmation_token"]}).status_code == 400
        assert client.get("/api/workspace").json()["role"] == ""
        select_role(client, "新岗位")
        assert client.post("/api/jd", json={"role": "新岗位", "jd": "岗位一"}).status_code == 200
        select_role(client, "其他岗位")
        assert client.get("/api/workspace").json()["jd"] == ""
        select_role(client, "新岗位")
        assert client.get("/api/workspace").json()["jd"] == "岗位一"


def test_confirmation_cannot_be_reused_and_non_role_input_is_rejected(tmp_path):
    with client_for(tmp_path) as client:
        result = client.post("/api/role", json={"role": "新岗位"}).json()
        body = {"role": "新岗位", "confirmation_token": result["confirmation_token"]}
        assert client.post("/api/role", json=body).status_code == 200
        assert client.post("/api/role", json=body).status_code == 400
        assert client.post("/api/role", json={"role": "123456"}).status_code == 400


@pytest.mark.parametrize("headers,status", [
    ({"x-offerpilot-access": "wrong"}, 401),
    ({"origin": "https://example.com"}, 403),
    ({"host": "evil.example:8765"}, 403),
    ({"sec-fetch-site": "cross-site"}, 403),
])
def test_private_workspace_access(tmp_path, headers, status):
    with client_for(tmp_path) as client:
        response = client.get("/api/workspace", headers=headers)
        assert response.status_code == status
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-frame-options"] == "DENY"


def test_json_body_validation_hides_input_and_enforces_size(tmp_path):
    with client_for(tmp_path) as client:
        assert client.post("/api/role", content="role=x").status_code == 415
        result = client.post("/api/role", content='{"role":', headers={"content-type": "application/json"})
        assert result.status_code == 422
        assert client.post("/api/role", json={"role": "private-input" * 100}).status_code == 422
        assert "private-input" not in client.post("/api/role", json={"role": 99}).text
        assert client.post("/api/role", content=" " * 400001, headers={"content-type": "application/json"}).status_code == 413


ROOT = Path(__file__).resolve().parents[2]


def node_compat(mode, path):
    result = subprocess.run(
        ["node", str(ROOT / "backend/tests/node_compat.mjs"), mode, str(path)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True, timeout=20,
    )
    return json.loads(result.stdout) if result.stdout.strip() else None


def test_existing_node_database_roundtrip_preserves_evidence_and_history(tmp_path):
    path = tmp_path / "interview.sqlite"
    node_compat("seed", path)
    with client_for(tmp_path) as client:
        source = client.get("/api/workspace").json()["sources"][0]
        assert source["legacy_question"] == "搜索摘要，尚待核对"
        assert source["questions"][0]["evidence"] == "面试官问：如何评估检索质量？"
        assert client.put("/api/sources/legacy-source/questions/legacy-question", json={
            "text": "如何度量检索效果？", "note": "新版笔记",
        }).status_code == 200
        new = create_source(client, question="如何分析查询计划？")
    restored = node_compat("inspect", path)
    legacy = next(item for item in restored["sources"] if item["id"] == "legacy-source")
    assert legacy["questions"][0]["text"] == "如何度量检索效果？"
    assert legacy["questions"][0]["note"] == "新版笔记"
    assert legacy["questions"][0]["evidence_question"] == "如何评估检索质量？"
    assert any(source["id"] == new for source in restored["sources"])
    assert restored["backup"]["attempts"][0]["feedback"] == "旧版点评"
    assert restored["backup"]["ability_evaluations"][0]["evaluation"]["topic"] == "RAG"


def test_python_database_schema_matches_node(tmp_path):
    with client_for(tmp_path):
        pass
    expected = node_compat("schema", tmp_path / "node.sqlite")
    actual = node_compat("schema", tmp_path / "interview.sqlite")
    assert actual == expected


def test_old_schema_upgrade_and_future_version_guard(tmp_path):
    path = tmp_path / "interview.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL)")
        db.execute("INSERT INTO sources VALUES ('old','旧来源','https://example.com','','来源未知','旧摘要','','2020-01-01')")
    with client_for(tmp_path) as client:
        item = client.get("/api/workspace").json()["sources"][0]
        assert item["interview_date"] == ""
        assert item["legacy_question"] == "旧摘要"
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA user_version=999")
    with pytest.raises(RuntimeError, match="数据库版本"):
        with client_for(tmp_path):
            pass


def test_source_deletion_cleans_evidence_and_topics_keeps_attempts(tmp_path):
    path = tmp_path / "interview.sqlite"
    node_compat("seed", path)
    with client_for(tmp_path) as client:
        assert client.delete("/api/sources/legacy-source").status_code == 200
    restored = node_compat("inspect", path)
    assert restored["sources"] == []
    assert restored["backup"]["attempts"][0]["id"] == "legacy-attempt"
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM question_evidence").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM question_topics").fetchone()[0] == 0
