import json
import hashlib
import hmac
import os
import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .database import connect, default_data_dir, initialize
from .ai import AiService
from .research.service import ResearchService
from .security import LocalAccessMiddleware


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class RoleInput(Input):
    role: str = Field(min_length=1, max_length=100)
    confirmation_token: str = ""


class ProfileInput(Input):
    role: str = Field(min_length=1, max_length=100)
    jd: str = Field(default="", max_length=30000)
    confirmed_requirements: str = Field(default="", max_length=10000)


def valid_date(value):
    try:
        if value and (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) or date.fromisoformat(value).isoformat() != value):
            raise ValueError()
    except ValueError:
        raise ValueError("日期无效，请使用 YYYY-MM-DD") from None
    return value


class SourceInput(Input):
    title: str = Field(min_length=1, max_length=1000)
    url: str = Field(min_length=1, max_length=10000)
    date: str = ""
    interview_date: str = ""
    type: str = "来源未知"
    question: str = Field(default="", max_length=10000)
    role: str = Field(default="", max_length=100)


class QuestionInput(Input):
    text: str = Field(min_length=1, max_length=10000)
    topic: str = Field(default="", max_length=100)


class TopicInput(Input):
    topic: str = Field(max_length=100)


class QuestionEditInput(Input):
    text: str = Field(min_length=1, max_length=10000)
    topic: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=30000)


class NoteInput(Input):
    note: str = Field(max_length=30000)


class DateInput(Input):
    interview_date: str


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def current_role(db):
    row = db.execute("SELECT value FROM settings WHERE key='role'").fetchone()
    return row[0] if row else ""


def validation_status(db, role):
    if not role:
        return "unset"
    row = db.execute("SELECT value FROM settings WHERE key='role_validation'").fetchone()
    try:
        value = json.loads(row[0]) if row else {}
        if value.get("role") == role and value.get("status") in {"valid", "confirmed"}:
            return value["status"]
    except (ValueError, AttributeError):
        pass
    return "unverified"


def list_sources(db):
    sources = [dict(row) for row in db.execute("SELECT * FROM sources ORDER BY created DESC")]
    grouped = {}
    query = """SELECT q.*, COALESCE(t.topic,'') AS topic,
        COALESCE(e.evidence,'') AS evidence, COALESCE(e.confirmed_text,'') AS evidence_question
        FROM questions q LEFT JOIN question_topics t ON t.kind='source' AND t.question_id=q.id
        LEFT JOIN question_evidence e ON e.question_id=q.id ORDER BY q.created,q.id"""
    for row in db.execute(query):
        grouped.setdefault(row["source_id"], []).append(dict(row))
    return [dict(source, legacy_question=source["question"], questions=grouped.get(source["id"], []))
            for source in sources]


def require_source(db, source_id):
    if not db.execute("SELECT id FROM sources WHERE id=?", (source_id,)).fetchone():
        raise HTTPException(404, "来源不存在")


def require_question(db, source_id, question_id):
    row = db.execute("SELECT * FROM questions WHERE source_id=? AND id=?", (source_id, question_id)).fetchone()
    if not row:
        raise HTTPException(404, "题目不存在")
    return dict(row)


def save_topic(db, question_id, topic):
    if topic:
        db.execute("INSERT OR REPLACE INTO question_topics VALUES ('source',?,?)", (question_id, topic))
    else:
        db.execute("DELETE FROM question_topics WHERE kind='source' AND question_id=?", (question_id,))


def add_question(db, source_id, text, topic=""):
    require_source(db, source_id)
    question = {"id": str(uuid4()), "source_id": source_id, "text": text, "created": now()}
    db.execute("INSERT INTO questions (id,source_id,text,created) VALUES (:id,:source_id,:text,:created)", question)
    save_topic(db, question["id"], topic)
    return dict(question, topic=topic)


def create_app(*, data_dir=None, token, port=8010, frontend_dir=None, services=None, http_transport=None, desktop=False):
    path = Path(data_dir if data_dir is not None else default_data_dir()) / "interview.sqlite"
    frontend = Path(frontend_dir or Path(__file__).resolve().parents[1] / "dist" / "vue")

    @asynccontextmanager
    async def lifespan(app):
        initialize(path)
        async with httpx.AsyncClient(transport=http_transport, follow_redirects=False, timeout=12) as client:
            config = dict(os.environ if services is None else services)
            app.state.ai = AiService(client, config)
            app.state.research = ResearchService(client, app.state.ai, config)
            yield

    app = FastAPI(title="OfferStrike", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(LocalAccessMiddleware, token=token, port=port, desktop=desktop)
    confirmations = {}
    role_revision = 0

    def database():
        with connect(path) as db:
            yield db

    transaction = Depends(database, scope="function")

    @app.exception_handler(HTTPException)
    async def http_error(_request, error):
        return JSONResponse({"error": error.detail}, status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(_request, _error):
        return JSONResponse({"error": "输入格式无效，请检查必填项、类型与长度"}, status_code=422)

    @app.exception_handler(ValueError)
    async def invalid_value(_request, error):
        return JSONResponse({"error": str(error)}, status_code=400)

    @app.exception_handler(sqlite3.Error)
    async def database_error(_request, _error):
        return JSONResponse({"error": "资料保存失败，请稍后重试"}, status_code=503)

    @app.get("/api/state")
    @app.get("/api/workspace")
    def workspace(db=transaction):
        from .practice import get_draft, role_coaching

        role = current_role(db)
        profile = db.execute("SELECT jd,confirmed_requirements FROM job_profiles WHERE role=?", (role,)).fetchone()
        rows = db.execute("""SELECT a.*,e.evaluation,aa.rating,l.kind AS question_link_kind,l.question_id AS question_link_id,
            CASE WHEN l.kind='source' THEN EXISTS(SELECT 1 FROM questions q JOIN sources s ON s.id=q.source_id WHERE q.id=l.question_id AND s.role=a.role)
            WHEN l.kind='debrief' THEN EXISTS(SELECT 1 FROM debriefs d WHERE d.id=l.question_id AND d.role=a.role)
            WHEN l.kind IN ('missing_source','missing_debrief') THEN 0 ELSE NULL END AS question_link_available
            FROM attempts a LEFT JOIN attempt_assessments aa ON aa.attempt_id=a.id LEFT JOIN attempt_question_links l ON l.attempt_id=a.id
            LEFT JOIN attempt_ability_evaluations e ON e.attempt_id=a.id ORDER BY a.created DESC LIMIT 30""")
        attempts = [{**dict(row), "evaluation": json.loads(row["evaluation"]) if row["evaluation"] else None} for row in rows]
        debriefs = [dict(row) for row in db.execute("SELECT d.*,COALESCE(t.topic,'') AS topic FROM debriefs d LEFT JOIN question_topics t ON t.kind='debrief' AND t.question_id=d.id ORDER BY d.created DESC")]
        return {"role": role, "roleValidation": validation_status(db, role),
                **(dict(profile) if profile else {"jd": "", "confirmed_requirements": ""}),
                "sources": list_sources(db), "aiConfigured": app.state.ai.configured,
                "aiModel": app.state.ai.model, "searchConfigured": bool(app.state.research.providers),
                "searchProviders": app.state.research.providers, "debriefs": debriefs, "attempts": attempts,
                "draft": get_draft(db, role), "roleCoaching": role_coaching(role),
                "practiceScope": hmac.new(token.encode(), role.encode(), hashlib.sha256).hexdigest() if role else ""}

    @app.post("/api/role")
    async def set_role(value: RoleInput, db=transaction):
        nonlocal role_revision
        if not any(character.isalpha() for character in value.role):
            raise ValueError("请输入职位或岗位方向，例如产品经理或前端开发")
        role_revision += 1
        previous = current_role(db)
        if value.confirmation_token:
            item = confirmations.pop(value.confirmation_token, None)
            if (not item or item[:3] != (value.role, previous, role_revision - 1)
                    or item[3] < time.monotonic()):
                raise ValueError("岗位确认已失效，请重新核对")
            db.execute("INSERT OR REPLACE INTO settings VALUES ('role',?)", (value.role,))
            db.execute("INSERT OR REPLACE INTO settings VALUES ('role_validation',?)",
                       (json.dumps({"role": value.role, "status": "confirmed"}),))
            return {"role": value.role, "status": "saved"}
        if previous == value.role and validation_status(db, previous) in {"valid", "confirmed"}:
            return {"role": previous, "status": "saved"}
        for key, item in list(confirmations.items()):
            if item[3] < time.monotonic():
                del confirmations[key]
        if len(confirmations) >= 100:
            confirmations.pop(next(iter(confirmations)))
        confirmation = str(uuid4())
        confirmations[confirmation] = (value.role, previous, role_revision, time.monotonic() + 300)
        return {"status": "needs_confirmation", "confirmation_token": confirmation,
                "message": "请确认这是你准备应聘的职位或岗位方向。"}

    @app.post("/api/jd")
    def save_profile(value: ProfileInput, db=transaction):
        db.execute("INSERT OR REPLACE INTO job_profiles VALUES (?,?,?)",
                   (value.role, value.jd, value.confirmed_requirements))
        return {"jd": value.jd, "confirmed_requirements": value.confirmed_requirements}

    @app.post("/api/sources", status_code=201)
    def create_source(value: SourceInput, db=transaction):
        from urllib.parse import urlsplit

        url = urlsplit(value.url)
        if url.scheme not in {"http", "https"} or not url.hostname:
            raise ValueError("请输入有效的 HTTP 或 HTTPS 链接")
        valid_date(value.date)
        valid_date(value.interview_date)
        source_id = str(uuid4())
        source_type = value.type if value.type in {"真实面经（自述）", "博主整理", "来源未知"} else "来源未知"
        db.execute("""INSERT INTO sources (id,title,url,date,interview_date,type,question,role,created)
                   VALUES (?,?,?,?,?,?, '',?,?)""",
                   (source_id, value.title, value.url, value.date, value.interview_date, source_type, value.role, now()))
        if value.question:
            add_question(db, source_id, value.question)
        return {"id": source_id}

    @app.post("/api/sources/{source_id}/questions", status_code=201)
    def create_question(source_id: str, value: QuestionInput, db=transaction):
        return add_question(db, source_id, value.text, value.topic)

    @app.put("/api/sources/{source_id}/questions/{question_id}")
    def edit_question(source_id: str, question_id: str, value: QuestionEditInput, db=transaction):
        require_question(db, source_id, question_id)
        db.execute("UPDATE questions SET text=? WHERE id=?", (value.text, question_id))
        if value.topic is not None:
            save_topic(db, question_id, value.topic)
        if value.note is not None:
            db.execute("UPDATE questions SET note=? WHERE id=?", (value.note, question_id))
        return require_question(db, source_id, question_id)

    @app.put("/api/sources/{source_id}/questions/{question_id}/topic")
    def set_topic(source_id: str, question_id: str, value: TopicInput, db=transaction):
        require_question(db, source_id, question_id)
        save_topic(db, question_id, value.topic)
        return {"topic": value.topic}

    @app.put("/api/sources/{source_id}/questions/{question_id}/note")
    def set_note(source_id: str, question_id: str, value: NoteInput, db=transaction):
        require_question(db, source_id, question_id)
        db.execute("UPDATE questions SET note=? WHERE id=?", (value.note, question_id))
        return {"note": value.note}

    @app.put("/api/sources/{source_id}/interview-date")
    def set_date(source_id: str, value: DateInput, db=transaction):
        require_source(db, source_id)
        valid_date(value.interview_date)
        db.execute("UPDATE sources SET interview_date=? WHERE id=?", (value.interview_date, source_id))
        return value.model_dump()

    @app.delete("/api/sources/{source_id}/questions/{question_id}")
    def delete_question(source_id: str, question_id: str, db=transaction):
        require_question(db, source_id, question_id)
        db.execute("DELETE FROM question_topics WHERE kind='source' AND question_id=?", (question_id,))
        db.execute("DELETE FROM question_evidence WHERE question_id=?", (question_id,))
        db.execute("DELETE FROM questions WHERE id=?", (question_id,))
        return {"ok": True}

    @app.delete("/api/sources/{source_id}")
    def delete_source(source_id: str, db=transaction):
        db.execute("""DELETE FROM question_topics WHERE kind='source'
                   AND question_id IN (SELECT id FROM questions WHERE source_id=?)""", (source_id,))
        db.execute("DELETE FROM question_evidence WHERE question_id IN (SELECT id FROM questions WHERE source_id=?)", (source_id,))
        db.execute("DELETE FROM questions WHERE source_id=?", (source_id,))
        db.execute("DELETE FROM sources WHERE id=?", (source_id,))
        return {"ok": True}

    @app.get("/")
    def index():
        if not (frontend / "index.html").is_file():
            raise HTTPException(503, "请先运行 npm run vue:build 构建页面")
        return FileResponse(frontend / "index.html")

    if (frontend / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")
    from .research.api import install_research

    install_research(app, transaction)
    from .practice import install_practice

    install_practice(app, transaction)
    from .career import install_career

    install_career(app, transaction)
    from .training_tasks import install_tasks

    install_tasks(app, transaction)
    from .misc import install_misc

    install_misc(app, transaction)
    return app
