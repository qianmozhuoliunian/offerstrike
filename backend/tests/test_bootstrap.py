import asyncio
import os
import re
import socket
import sys
from pathlib import Path

import httpx


def test_web_runner_announces_after_listening_and_uses_isolated_data(tmp_path):
    async def check():
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        root = Path(__file__).resolve().parents[2]
        env = {**os.environ, 'AI_API_KEY': 'synthetic-bootstrap', 'AI_MODEL': 'synthetic-model', 'AI_BASE_URL': 'https://api.openai.com/v1',
               'PYTHONIOENCODING': 'ascii:strict'}
        env.pop('INTERVIEW_DESKTOP_TOKEN', None)
        process = await asyncio.create_subprocess_exec(sys.executable, '-u', '-m', 'backend.run', '--port', str(port), '--data-dir', str(tmp_path),
            cwd=root, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            line = await asyncio.wait_for(process.stdout.readline(), 15)
            match = re.search(rb'#access=([a-f0-9]{64})', line)
            assert match
            async with httpx.AsyncClient() as client:
                address = f'http://127.0.0.1:{port}'
                assert (await client.get(address + '/api/workspace')).status_code == 401
                response = await client.get(address + '/api/workspace', headers={'x-offerpilot-access': match[1].decode()})
                assert response.status_code == 200
                assert response.json()['sources'] == []
                assert response.json()['aiModel'] == 'synthetic-model'
                assert (tmp_path / 'interview.sqlite').is_file()
        finally:
            if process.returncode is None:
                process.terminate()
            await asyncio.wait_for(process.wait(), 5)
    asyncio.run(check())
