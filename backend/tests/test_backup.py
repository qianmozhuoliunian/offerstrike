from backend.tests.test_workspace import client_for, create_source, select_role
import json
import sqlite3
import subprocess
from pathlib import Path
from uuid import uuid4
import httpx

ROOT = Path(__file__).resolve().parents[2]


def test_old_node_backup_and_native_export_remain_interoperable(tmp_path):
    old = tmp_path / 'old.sqlite'
    helper = ROOT / 'backend/tests/node_compat.mjs'
    subprocess.run(['node', str(helper), 'seed', str(old)], check=True, capture_output=True)
    # Replace the schema-only fixture with an evaluation accepted by both versions.
    evaluation = {'topic': '', 'strengths': [], 'weaknesses': [], 'unverified': ['召回评估'],
                  'followup_point': '', 'suggested_followup': '', 'recommended_action': 'review'}
    with sqlite3.connect(old) as db:
        db.execute('UPDATE attempt_ability_evaluations SET evaluation=?', (json.dumps(evaluation),))
    backup = json.loads(subprocess.run(['node', str(helper), 'inspect', str(old)], check=True, capture_output=True, encoding='utf-8').stdout)['backup']
    with client_for(tmp_path / 'restored') as client:
        assert client.post('/api/import', json={'mode': 'merge', 'data': backup}).status_code == 200
        restored = client.get('/api/export').json()
        assert restored['sources'][0]['questions'][0]['evidence'] == '面试官问：如何评估检索质量？'
        assert restored['ability_evaluations'][0]['evaluation']['unverified'] == ['召回评估']
        assert restored['sources'][0]['question'] == '搜索摘要，尚待核对'
    file = tmp_path / 'backup.json'
    file.write_text(json.dumps(restored, ensure_ascii=False), encoding='utf-8')
    roundtrip = json.loads(subprocess.run(['node', str(helper), 'import', str(tmp_path / 'new.sqlite'), str(file)], check=True, capture_output=True, encoding='utf-8').stdout)
    assert roundtrip['attempts'] == backup['attempts']
    assert roundtrip['sources'][0]['questions'][0]['text'] == backup['sources'][0]['questions'][0]['text']


def test_backup_preserves_draft_and_tasks_with_atomic_invalid_restore(tmp_path):
    role = 'Python 开发工程师'
    with client_for(tmp_path / 'source') as client:
        select_role(client)
        create_source(client, question='如何评估检索质量？')
        question = client.get('/api/workspace').json()['sources'][0]['questions'][0]
        assert client.put('/api/draft', json={'role': role, 'question': question['text'], 'answer': '尚未提交',
            'question_ref': {'kind': 'source', 'id': question['id']}}).status_code == 200
        task = client.post('/api/training/tasks/create', json={'role': role, 'topic': 'RAG', 'request_id': str(uuid4())}).json()['task']
        backup = client.get('/api/export').json()
    with client_for(tmp_path / 'target') as client:
        invalid = {**backup, 'draft_question_links': [{'role': role, 'kind': 'source', 'question_id': []}]}
        assert client.post('/api/import', json={'mode': 'merge', 'data': invalid}).status_code == 400
        assert client.get('/api/workspace').json()['sources'] == []
        assert client.post('/api/import', json={'mode': 'merge', 'data': backup}).status_code == 200
        select_role(client)
        history = client.get('/api/practice/history', params={'role': role}).json()
        assert history['draft']['answer'] == '尚未提交'
        assert history['draft']['question_ref']['id'] == question['id']
        assert client.get('/api/training/tasks', params={'role': role}).json()['tasks'][0]['id'] == task['id']
    with client_for(tmp_path / 'target') as client:
        assert client.get('/api/practice/history', params={'role': role}).json()['draft']['answer'] == '尚未提交'


def test_debrief_library_practice_and_resume_explicit_data_scope(tmp_path):
    sent = []
    def respond(request):
        sent.append(json.loads(request.content))
        content = json.dumps({'status': 'ok', 'items': [{'requirement': 'Python', 'evidence': '使用 Python 开发工具'},
            {'requirement': '虚构能力', 'evidence': '原文没有的经历'}]})
        return httpx.Response(200, json={'choices': [{'message': {'content': content}}]})
    role = 'Python 开发工程师'
    with client_for(tmp_path, services={'AI_API_KEY': 'test', 'AI_MODEL': 'test'}, http_transport=httpx.MockTransport(respond)) as client:
        select_role(client)
        assert client.post('/api/debriefs', json={'role': role, 'question': '', 'include_in_library': True}).status_code == 400
        record = client.post('/api/debriefs', json={'role': role, 'company': '合成公司', 'question': '如何评估检索质量？', 'include_in_library': True}).json()
        assert client.put(f'/api/debriefs/{record["id"]}/topic', json={'topic': 'RAG'}).status_code == 200
        attempt = client.post('/api/practice/local', json={'role': role, 'question': record['question'], 'answer': '练习内容保密',
            'question_ref': {'kind': 'debrief', 'id': record['id']}, 'request_id': str(uuid4())})
        assert attempt.status_code == 201
        assert client.get('/api/workspace').json()['debriefs'][0]['id'] == record['id']
        body = {'role': role, 'resume': '我使用 Python 开发工具'}
        assert client.post('/api/career/resume', json=body).status_code == 400
        assert not sent
        result = client.post('/api/career/resume', json={**body, 'confirm': True})
        assert result.status_code == 200
        assert len(result.json()['abilities']) == 1
        assert sent[0]['messages'][1]['content'] == body['resume']
        assert '练习内容保密' not in json.dumps(sent)
        assert client.put(f'/api/debriefs/{record["id"]}/library', json={'include_in_library': False}).status_code == 200
        assert client.post('/api/practice/local', json={'role': role, 'question': record['question'], 'answer': '合成回答',
            'question_ref': {'kind': 'debrief', 'id': record['id']}, 'request_id': str(uuid4())}).status_code == 400


def test_backup_preview_restore_and_existing_data_conflicts(tmp_path):
    with client_for(tmp_path / "original") as client:
        select_role(client)
        source_id = create_source(client, question="如何排查慢查询？")
        backup_response = client.get("/api/export")
        assert backup_response.status_code == 200
        backup = backup_response.json()
        assert backup["version"] == 1
        question_id = backup["sources"][0]["questions"][0]["id"]
        assert "AI_API_KEY" not in backup_response.text
    with client_for(tmp_path / "restored") as client:
        preview = client.post("/api/import", json={"mode": "preview", "data": backup})
        assert preview.status_code == 200
        assert preview.json()["新增"] > 0
        assert client.get("/api/workspace").json()["sources"] == []
        assert client.post("/api/import", json={"mode": "merge", "data": backup}).status_code == 200
        state = client.get("/api/workspace").json()
        assert state["sources"][0]["id"] == source_id
        assert state["sources"][0]["questions"][0]["id"] == question_id
        changed = {**backup, "sources": [{**backup["sources"][0], "title": "备份中的不同标题"}]}
        assert client.post("/api/import", json={"mode": "merge", "data": changed}).status_code == 200
        assert client.get("/api/workspace").json()["sources"][0]["title"] == "合成测试来源"
        invalid = {**backup, "attempts": [{"id": "invalid"}]}
        assert client.post("/api/import", json={"mode": "merge", "data": invalid}).status_code == 400
