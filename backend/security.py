import hmac

from starlette.responses import JSONResponse


PRIVATE_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class LocalAccessMiddleware:
    def __init__(self, app, token, port, desktop=False):
        self.app = app
        self.token = token.encode("utf-8")
        self.port = port
        self.desktop = desktop

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1")
        origin = headers.get(b"origin")
        site = headers.get(b"sec-fetch-site")

        async def private_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [
                    (key.lower().encode(), value.encode()) for key, value in PRIVATE_HEADERS.items()
                ]
            await send(message)

        async def reject(status, message):
            await JSONResponse({"error": message}, status_code=status)(scope, receive, private_send)

        if (host not in {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}
                or (origin and origin != f"http://{host}".encode())
                or (site and site not in {b"same-origin", b"none"})):
            return await reject(403, "请求来源不受信任")
        api = scope["path"].startswith("/api/")
        if self.desktop or api:
            key = b"x-interview-desktop" if self.desktop else b"x-offerpilot-access"
            if not hmac.compare_digest(headers.get(key, b""), self.token):
                return await reject(401, "请通过桌面工作台打开" if self.desktop else "请从启动终端复制完整的本机工作台链接打开")
        if api:
            if scope["method"] in {"POST", "PUT", "PATCH"}:
                content_type = headers.get(b"content-type", b"").split(b";")[0].strip().lower()
                if content_type != b"application/json":
                    return await reject(415, "请求必须使用 application/json")
                chunks = []
                total = 0
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    total += len(chunk)
                    limit = 30000000 if scope["path"] == "/api/import" else 400000
                    if total > limit:
                        return await reject(413, "内容过长，请缩短后重试")
                    chunks.append(chunk)
                    if not message.get("more_body", False):
                        break

                original_receive = receive
                buffered_body = b"".join(chunks)
                consumed = False

                async def buffered_receive():
                    nonlocal consumed
                    if consumed:
                        return await original_receive()
                    consumed = True
                    return {"type": "http.request", "body": buffered_body, "more_body": False}

                receive = buffered_receive
        return await self.app(scope, receive, private_send)
