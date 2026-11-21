import json
import re
import time
from uuid import uuid4

from fastapi import Query
from pydantic import Field

from .knowledge import search_focus, topic_key
from .practice import RoleBody


ACTIVE = {"proposed", "searching", "review", "ready"}


def milliseconds():
    return round(time.time() * 1000)


def recover(db, role, now):
    db.execute("UPDATE training_tasks SET status='failed',reason='timeout' WHERE role=? AND status='searching' AND started_at<=?", (role, now - 80000))
    db.execute("""UPDATE training_tasks SET status='failed',reason='question_removed' WHERE role=? AND status='ready'
        AND NOT EXISTS(SELECT 1 FROM questions q JOIN sources s ON s.id=q.source_id
        JOIN question_evidence e ON e.question_id=q.id AND e.confirmed_text=q.text
        WHERE q.id=training_tasks.question_id AND s.role=training_tasks.role)""", (role,))


def read_tasks(db, role, task_id="", now=None):
    observed_at = milliseconds() if now is None else now
    if db.in_transaction:
        recover(db, role, observed_at)
    else:
        # Recovery writes finish before an async search or cancellation can yield.
        with db:
            recover(db, role, observed_at)
    if not task_id:
        return [dict(row) for row in db.execute("""SELECT id,topic,point,status,reason,created_at,question_id,attempt_id FROM training_tasks
            WHERE role=? ORDER BY CASE WHEN status IN ('proposed','searching','review','ready') THEN 0 ELSE 1 END,
            created_at DESC,rowid DESC LIMIT 12""", (role,))]
    row = db.execute("SELECT * FROM training_tasks WHERE id=? AND role=?", (task_id, role)).fetchone()
    if not row:
        raise ValueError("本岗位的训练任务不存在")
    value = dict(row)
    topics = json.loads(value.pop("topics"))
    result = value.pop("result")
    question = db.execute("SELECT q.id,q.source_id,q.text,s.title,s.url FROM questions q JOIN sources s ON s.id=q.source_id WHERE q.id=? AND s.role=?", (value["question_id"], role)).fetchone() if value["question_id"] else None
    return {**value, "research_request": {"role": role, "topics": topics, "focus": search_focus(value["topic"], value["point"])},
            "result": json.loads(result) if result else None, "question": dict(question) if question else None}


def create_task(db, role, topic, request_id, suggest):
    if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", request_id, re.I):
        raise ValueError("训练任务请求编号无效")
    with db:
        db.execute("BEGIN IMMEDIATE")
        recover(db, role, milliseconds())
        existing = db.execute("SELECT id,topic FROM training_tasks WHERE role=? AND request_id=?", (role, request_id)).fetchone()
        if existing and topic_key(existing["topic"]) != topic_key(topic):
            raise ValueError("请求编号已用于其他训练主题")
        task_id = existing["id"] if existing else None
        if not task_id:
            active = db.execute("SELECT id,topic FROM training_tasks WHERE role=? AND status IN ('proposed','searching','review','ready')", (role,)).fetchall()
            task_id = next((item["id"] for item in active if topic_key(item["topic"]) == topic_key(topic)), None)
        if not task_id:
            suggestion = suggest(topic)
            if not suggestion:
                raise ValueError("备战建议已更新，请重新选择补题目标")
            task_id = str(uuid4())
            db.execute("""INSERT INTO training_tasks (id,role,request_id,topic,point,topics,status,created_at)
                VALUES (?,?,?,?,?,?,'proposed',?)""", (task_id, role, request_id, suggestion["topic"], suggestion["point"],
                json.dumps(suggestion["research_request"]["topics"], ensure_ascii=False), milliseconds()))
    return read_tasks(db, role, task_id)


def start_search(db, task):
    with db:
        return bool(db.execute("UPDATE training_tasks SET status='searching',started_at=? WHERE id=? AND role=? AND status='proposed'", (milliseconds(), task["id"], task["role"])).rowcount)


def settle_search(db, task, status, reason, result=None):
    with db:
        db.execute("UPDATE training_tasks SET status=?,reason=?,result=? WHERE id=? AND role=? AND status='searching'",
                   (status, reason, json.dumps(result, ensure_ascii=False) if result is not None else None, task["id"], task["role"]))


class CreateTaskInput(RoleBody):
    topic: str = Field(default="", max_length=40)
    request_id: str


class CancelTaskInput(RoleBody):
    id: str = Field(min_length=1, max_length=200)


def install_tasks(app, transaction):
    from .career import career_plan
    from .research.api import require_role

    @app.get("/api/training/tasks")
    def tasks(role: str = Query(max_length=100), id: str = Query(default="", max_length=200), db=transaction):
        require_role(db, role)
        return {"task" if id else "tasks": read_tasks(db, role, id)}

    @app.post("/api/training/tasks/create")
    def create(value: CreateTaskInput, db=transaction):
        require_role(db, value.role)

        def suggest(topic):
            return next((task for task in career_plan(db, value.role, {"topics": [topic] if topic else []})["tasks"]
                         if task["action"] == "research" and topic_key(task["topic"]) == topic_key(topic)), None)

        return {"task": create_task(db, value.role, value.topic, value.request_id, suggest)}

    @app.post("/api/training/tasks/cancel")
    async def cancel(value: CancelTaskInput, db=transaction):
        require_role(db, value.role)
        with db:
            read_tasks(db, value.role, value.id)
            db.execute("UPDATE training_tasks SET status='cancelled',reason='cancelled',result=NULL WHERE id=? AND role=? AND status IN ('proposed','searching','review','ready')", (value.id, value.role))
            result = read_tasks(db, value.role, value.id)
        running = app.state.research_runs.get(value.id)
        if running:
            running.cancel()
        return {"task": result}
