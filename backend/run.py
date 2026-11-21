"""Run the native FastAPI workbench from the repository root."""

import argparse
import asyncio
import os
import re
import secrets
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

from .app import create_app


def main():
    root = Path(__file__).resolve().parents[1]
    desktop_token = os.environ.get("INTERVIEW_DESKTOP_TOKEN", "")
    if not desktop_token:
        load_dotenv(root / ".env", override=False)
    parser = argparse.ArgumentParser(description="OfferStrike Vue / FastAPI 工作台")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--data-dir", type=Path)
    arguments = parser.parse_args()
    if not 1024 <= arguments.port <= 65535:
        parser.error("端口应介于 1024 和 65535 之间")
    if os.name != "nt":
        os.umask(0o077)
    if desktop_token and not re.fullmatch(r"[a-f0-9]{64}", desktop_token):
        parser.error("桌面访问凭证格式无效")
    token = desktop_token or secrets.token_hex(32)
    app = create_app(data_dir=arguments.data_dir, token=token, port=arguments.port, desktop=bool(desktop_token))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=arguments.port, access_log=False, log_level="warning"))

    async def serve():
        async def announce():
            while not server.started and not server.should_exit:
                await asyncio.sleep(.02)
            if server.started:
                address = f"http://127.0.0.1:{arguments.port}"
                print(f"OFFERSTRIKE_READY {address}" if desktop_token else f"本机工作台 {address}/#access={token}", flush=True)
        announcement = asyncio.create_task(announce())
        try:
            await server.serve()
        finally:
            announcement.cancel()

    asyncio.run(serve())


if __name__ == "__main__":
    main()
