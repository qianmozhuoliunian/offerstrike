import asyncio
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Annotated, Literal

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

Provider = Literal["Tavily", "Exa"]
Domain = Literal["nowcoder.com", "juejin.cn", "zhihu.com", "csdn.net",
                 "cnblogs.com", "51cto.com", "segmentfault.com"]
Role = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Company = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider
    role: Role
    company: Company = ""
    domains: Annotated[list[Domain], Field(min_length=1, max_length=7)]
    phrase: Literal["面经", "面试经验", "面试经历"]
    from_date: date | None = None
    through_date: date | None = None

    @model_validator(mode="after")
    def check_scope(self):
        if len(set(self.domains)) != len(self.domains):
            raise ValueError("请选择有效且不重复的来源")
        if (self.provider == "Exa") != (self.phrase == "面试经历"):
            raise ValueError("检索方式与搜索服务不匹配")
        if (self.from_date is None) != (self.through_date is None) or (
            self.from_date and self.through_date and self.from_date > self.through_date
        ):
            raise ValueError("不支持的时间范围")
        return self


class Candidate(BaseModel):
    title: str
    url: str
    snippet: str
    published_date: str


class SearchResponse(BaseModel):
    results: list[Candidate]


def create_app(*, transport=None, keys=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.keys = keys if keys is not None else {
            "Tavily": os.getenv("TAVILY_API_KEY"),
            "Exa": os.getenv("EXA_API_KEY"),
        }
        async with httpx.AsyncClient(transport=transport, timeout=12, follow_redirects=False) as client:
            app.state.client = client
            yield

    app = FastAPI(title="面经研究检索", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.get("/health")
    def health(request: Request):
        return {"providers": [name for name, key in request.app.state.keys.items() if key]}

    @app.post("/v1/retrieve", response_model=SearchResponse)
    async def retrieve(query: SearchRequest, request: Request):
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise HTTPException(415, "请求必须使用 application/json")
        key = request.app.state.keys.get(query.provider)
        if not key:
            raise HTTPException(503, f"Python 研究服务未配置 {query.provider} 密钥")
        today = datetime.now(timezone.utc).date()
        if query.through_date and query.through_date > today:
            raise HTTPException(422, "时间范围不能超过今天")

        text = " ".join(filter(None, (query.role, query.company, query.phrase)))
        if query.provider == "Exa":
            url, headers = "https://api.exa.ai/search", {"x-api-key": key}
            payload = dict(query=text, type="auto", numResults=10, includeDomains=query.domains,
                           contents={"highlights": True})
            if query.from_date:
                payload.update(startPublishedDate=f"{query.from_date}T00:00:00.000Z",
                               endPublishedDate=f"{query.through_date}T23:59:59.999Z")
        else:
            url, headers = "https://api.tavily.com/search", {"authorization": f"Bearer {key}"}
            payload = dict(query=text, search_depth="basic", max_results=15, include_domains=query.domains,
                           include_answer=False, include_raw_content=False, include_published_date=True)
            if query.from_date:
                payload["start_date"] = query.from_date.isoformat()

        try:
            async with asyncio.timeout(12):
                response = await request.app.state.client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                body = response.json()
                rows = body.get("results") if isinstance(body, dict) else None
                if not isinstance(rows, list):
                    raise ValueError("results")
        except (TimeoutError, httpx.TimeoutException):
            raise HTTPException(504, f"{query.provider} 检索超时") from None
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, f"{query.provider} 检索失败") from None

        results = []
        for row in rows[:payload.get("numResults", 15)]:
            if not isinstance(row, dict):
                continue
            title, link = row.get("title"), row.get("url")
            if not isinstance(title, str) or not title.strip() or not isinstance(link, str):
                continue
            if query.provider == "Exa":
                highlights = row.get("highlights")
                snippet = " … ".join(item for item in highlights if isinstance(item, str)) if isinstance(highlights, list) else ""
                published = row.get("publishedDate")
            else:
                snippet, published = row.get("content"), row.get("published_date")
            results.append(Candidate(title=title, url=link, snippet=snippet if isinstance(snippet, str) else "",
                                     published_date=published if isinstance(published, str) else ""))
        return SearchResponse(results=results)

    return app


app = create_app()
