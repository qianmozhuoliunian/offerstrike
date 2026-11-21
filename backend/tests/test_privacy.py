from pathlib import Path
from uuid import uuid4

import httpx

from backend.tests.test_workspace import client_for, create_source, select_role


def test_workspace_backup_history_and_static_files_keep_private_boundaries(tmp_path):
    frontend = tmp_path / 'frontend'
    (frontend / 'assets').mkdir(parents=True)
    (frontend / 'index.html').write_text('<main>Public application shell</main>')
    marker = 'synthetic-private-answer-for-access-test'
    (tmp_path / '.env').write_text('PRIVATE_FIXTURE=' + marker)
    keys = {'AI_API_KEY': 'synthetic-model-private-key', 'AI_MODEL': 'test', 'TAVILY_API_KEY': 'synthetic-search-private-key'}
    with client_for(tmp_path / 'database', frontend_dir=frontend, services=keys) as client:
        select_role(client)
        create_source(client, question='隐私边界测试问题')
        assert client.post('/api/practice/local', json={'role': 'Python 开发工程师', 'question': '隐私边界测试问题',
            'answer': marker, 'request_id': str(uuid4())}).status_code == 201
        exported = client.get('/api/export')
        assert marker in exported.text
        for value in (keys['AI_API_KEY'], keys['TAVILY_API_KEY']):
            assert value not in exported.text
            assert value not in client.get('/api/state').text
        client.headers.pop('x-offerpilot-access')
        for path in ['/api/state', '/api/workspace', '/api/export', '/api%2Fexport', '/api/practice/history?role=Python',
                     '/api/career/ability-history?role=Python', '/api/training/tasks?role=Python', '/api/export?access=' + 'a' * 64]:
            response = client.get(path)
            assert response.status_code == 401
            assert marker not in response.text
            assert response.headers['cache-control'] == 'no-store'
            assert response.headers['referrer-policy'] == 'no-referrer'
        assert client.get('/').status_code == 200
        for path in ['/.env', '/backend/app.py', '/data/interview.sqlite', '/interview.sqlite', '/openapi.json',
                     '/assets/../.env', '/assets/%2e%2e/%2e%2e/.env']:
            response = client.get(path)
            assert response.status_code == 404
            assert marker not in response.text


def test_failed_ai_and_validation_never_echo_credentials_or_answer(tmp_path):
    marker = 'synthetic-private-answer-for-error-test'
    key = 'synthetic-model-private-credential'

    def fail(_request):
        return httpx.Response(503, json={'error': key + marker})

    with client_for(tmp_path, services={'AI_API_KEY': key, 'AI_MODEL': 'test'}, http_transport=httpx.MockTransport(fail)) as client:
        select_role(client)
        response = client.post('/api/practice/dialogue/turn', json={'role': 'Python 开发工程师', 'question': '解释隐私边界',
            'answer': marker, 'request_id': str(uuid4())})
        assert response.status_code == 400
        assert marker not in response.text and key not in response.text
        response = client.post('/api/role', json={'role': {'private': marker}})
        assert response.status_code == 422
        assert marker not in response.text
