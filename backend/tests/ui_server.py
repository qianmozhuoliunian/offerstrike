"""Isolated HTTP server for browser checks, with simulated external services."""

import argparse
import json
import secrets

import httpx
import uvicorn

from backend.app import create_app


TITLE = "远帆科技 AI Agent 开发实习一面"
EVIDENCE = "面试官问：如何设计缓存淘汰策略？"


def respond(request):
    if request.url.host == "api.tavily.com":
        return httpx.Response(200, json={"results": [{"title": TITLE,
            "url": "https://www.cnblogs.com/offerstrike-test/p/123.html", "content": "模拟公开线索", "published_date": "2026-11-01"}]})
    if request.url.host == "www.cnblogs.com":
        return httpx.Response(200, headers={"content-type": "text/html"}, text=f'<div id="cnblogs_post_body"><h2>{TITLE}</h2><p>{EVIDENCE}</p></div>')
    if request.url.host == "api.openai.com":
        messages = json.loads(request.content)["messages"]
        if '从简历提取' in messages[0]['content']:
            content = json.dumps({'status': 'ok', 'items': [{'requirement': 'Python', 'evidence': '使用 Python 开发工具'}]})
            return httpx.Response(200, json={'choices': [{'message': {'content': content}}]})
        payload = json.loads(messages[1]["content"])
        if '"summary"' in messages[0]["content"]:
            result = {"summary": "本轮解释了缓存用途，淘汰策略仍待验证。"}
        elif "answer" in payload:
            result = {"feedback": "你解释了缓存用途，可以继续说明淘汰策略。", "follow_up": "你会如何实现 LRU 缓存？",
                "focus": "缓存淘汰策略", "evidence": payload["answer"], "next_step": "实现一个简单的 LRU 缓存",
                "evaluation": {"topic": "缓存", "strengths": [{"point": "缓存基本用途", "evidence": payload["answer"]}],
                    "weaknesses": [{"point": "淘汰策略", "type": "missing", "evidence": payload["answer"], "requirement": "缓存淘汰策略"}],
                    "unverified": ["并发访问处理"], "followup_point": "淘汰策略", "recommended_action": "followup"}}
        else:
            result = {"items": [{"question": "如何设计缓存淘汰策略？", "evidence": EVIDENCE}]}
        content = json.dumps(result)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50}})
    raise AssertionError("Browser test attempted an unexpected external destination")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data-dir", required=True)
    args = parser.parse_args()
    token = secrets.token_hex(32)
    app = create_app(data_dir=args.data_dir, token=token, port=args.port,
        services={"TAVILY_API_KEY": "test-search", "AI_API_KEY": "test-model", "AI_MODEL": "test"},
        http_transport=httpx.MockTransport(respond))
    print(f"http://127.0.0.1:{args.port}/#access={token}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)
