import asyncio
import os
from urllib.parse import urlsplit

import httpx


class AiService:
    def __init__(self, client: httpx.AsyncClient, config=None):
        config = os.environ if config is None else config
        self.client = client
        self.key = config.get("AI_API_KEY", "")
        self.model = config.get("AI_MODEL", "")
        self.base = (config.get("AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        url = urlsplit(self.base)
        if (url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})
                or url.username or url.password or url.query or url.fragment or not url.hostname):
            raise ValueError("AI 服务地址须使用 HTTPS 或本机 HTTP，且不含凭证、参数或片段")
        self.deepseek = url.hostname == "api.deepseek.com"

    @property
    def configured(self):
        return bool(self.key and self.model)

    async def complete(self, messages, *, max_tokens=800, temperature=0.2, timeout=20):
        if not self.configured:
            raise ValueError("尚未配置 AI 服务")
        payload = {"model": self.model, "messages": messages, "temperature": temperature,
                   "max_tokens": max_tokens, "response_format": {"type": "json_object"}}
        if self.deepseek:
            payload["thinking"] = {"type": "disabled"}
        try:
            response = await asyncio.wait_for(self.client.post(
                f"{self.base}/chat/completions", headers={"authorization": f"Bearer {self.key}"}, json=payload, timeout=timeout,
            ), timeout=timeout)
            response.raise_for_status()
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError()
            usage = result.get("usage")
            return content, usage if isinstance(usage, dict) else {}
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, asyncio.TimeoutError):
            raise ValueError("AI 服务暂不可用，请检查配置后重试") from None
