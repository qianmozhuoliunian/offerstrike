import json
import re
from uuid import uuid4

import httpx

from .app import list_sources, now, valid_date
from .evaluation import AbilityEvaluation


REQUIRED = ("settings", "profiles", "sources", "attempts", "drafts", "debriefs")
OPTIONAL = ("assessments", "attempt_details", "draft_contexts", "attempt_question_links", "draft_question_links",
            "dialogue_origins", "dialogue_summaries", "dialogue_coaching", "dialogue_requests", "ability_evaluations", "training_tasks")


def export_data(db):
    # All tables belong to one snapshot while practice may save concurrently.
    if not db.in_transaction:
        db.execute("BEGIN")
    tables = {"settings": "SELECT key,value FROM settings WHERE key='role'", "profiles": "SELECT * FROM job_profiles",
              "attempts": "SELECT * FROM attempts ORDER BY created DESC", "drafts": "SELECT * FROM drafts",
              "debriefs": "SELECT d.*,COALESCE(t.topic,'') AS topic FROM debriefs d LEFT JOIN question_topics t ON t.kind='debrief' AND t.question_id=d.id ORDER BY d.created DESC",
              "assessments": "SELECT * FROM attempt_assessments"}
    for name in OPTIONAL:
        if name not in {"assessments", "ability_evaluations"}:
            tables[name] = "SELECT * FROM " + name
    result = {name: [dict(row) for row in db.execute(query)] for name, query in tables.items()}
    result.update(version=1, exported_at=now(), sources=list_sources(db), ability_evaluations=[
        {"attempt_id": row["attempt_id"], "evaluation": json.loads(row["evaluation"])}
        for row in db.execute("SELECT * FROM attempt_ability_evaluations ORDER BY attempt_id")])
    for task in result["training_tasks"]:
        task["topics"] = json.loads(task["topics"])
        task["result"] = json.loads(task["result"]) if task["result"] else None
    return result


def text(value, maximum, name, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError(f"备份中的{name}无效")
    return value


def identifier(value):
    return text(value, 200, "编号", True)


def record(value):
    if not isinstance(value, dict):
        raise ValueError("备份记录格式无效")
    return value


def normalized_url(value):
    try:
        url = httpx.URL(value)
        if url.scheme not in {"http", "https"} or not url.host:
            raise ValueError()
        return str(url.copy_with(path=url.path or "/"))
    except (ValueError, TypeError, httpx.InvalidURL):
        raise ValueError("备份中的链接无效") from None


def import_data(db, data, commit=False):
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1:
        raise ValueError("备份版本不受支持")
    for name in REQUIRED:
        if not isinstance(data.get(name), list) or len(data[name]) > 20000:
            raise ValueError(f"备份中的 {name} 无效")
    for name in OPTIONAL:
        if name in data and (not isinstance(data[name], list) or len(data[name]) > 20000):
            raise ValueError(f"备份中的 {name} 无效")
    with db:
        db.execute("BEGIN IMMEDIATE")
        try:
            return plan_import(db, data, commit)
        except (TypeError, KeyError, AttributeError, OverflowError):
            raise ValueError("备份记录格式无效，请检查文件") from None


def plan_import(db, data, commit):
    seen = set()
    operations = []
    counts = {"新增": 0, "保留现有": 0}

    def unique(kind, key):
        pair = (kind, key)
        if pair in seen:
            raise ValueError("备份包含重复记录")
        seen.add(pair)

    def exists(query, args):
        return db.execute(query, args).fetchone()

    def add(present, query, values):
        counts["保留现有" if present else "新增"] += 1
        if not present:
            operations.append((query, values))

    for item in data["settings"]:
        record(item)
        if item.get("key") != "role":
            raise ValueError("备份中包含不支持的设置")
        value = text(item.get("value"), 100, "岗位")
        unique("setting", "role")
        add(exists("SELECT 1 FROM settings WHERE key='role'", ()), "INSERT INTO settings VALUES ('role',?)", (value,))
    for item in data["profiles"]:
        record(item)
        role = text(item.get("role"), 100, "岗位", True)
        unique("profile", role)
        values = (role, text(item.get("jd"), 30000, "岗位描述"), text(item.get("confirmed_requirements"), 10000, "岗位要求"))
        add(exists("SELECT 1 FROM job_profiles WHERE role=?", (role,)), "INSERT INTO job_profiles VALUES (?,?,?)", values)
    accepted_sources = set()
    compatible_refs = {}
    backup_refs = set()
    evidence_questions = set()
    for item in data["sources"]:
        record(item)
        source_id = identifier(item.get("id"))
        unique("source", source_id)
        title = text(item.get("title"), 100000, "标题", True).strip()
        role = text(item.get("role"), 100000, "岗位").strip()
        url = normalized_url(item.get("url"))
        published = valid_date(text(item.get("date", ""), 10, "发布日期"))
        interview_date = valid_date(text(item.get("interview_date", ""), 10, "面试日期"))
        source_type = item.get("type") if item.get("type") in {"真实面经（自述）", "博主整理", "来源未知"} else "来源未知"
        legacy = text(item.get("question"), 100000, "旧摘录")
        created = text(item.get("created"), 100, "时间", True)
        existing = exists("SELECT url,role FROM sources WHERE id=?", (source_id,))
        same_url = False
        if existing:
            try:
                same_url = normalized_url(existing["url"]) == url
            except ValueError:
                pass
        if not existing or (same_url and existing["role"] == role):
            accepted_sources.add(source_id)
        add(existing, "INSERT INTO sources (id,title,url,date,type,question,role,created,interview_date) VALUES (?,?,?,?,?,?,?,?,?)",
            (source_id, title, url, published, source_type, legacy, role, created, interview_date))
        questions = item.get("questions")
        if not isinstance(questions, list) or len(questions) > 20000:
            raise ValueError("备份中的题目无效")
        for question in questions:
            record(question)
            question_id = identifier(question.get("id"))
            unique("question", question_id)
            backup_refs.add(("source", question_id))
            if question.get("source_id") != source_id:
                raise ValueError("题目与来源不匹配")
            value = text(question.get("text"), 10000, "题目", True)
            values = (question_id, source_id, value, text(question.get("created"), 100, "时间", True), text(question.get("note", ""), 30000, "笔记"))
            previous = exists("SELECT source_id,text FROM questions WHERE id=?", (question_id,))
            compatible = source_id in accepted_sources and (not previous or (previous["source_id"] == source_id and previous["text"] == value))
            if compatible:
                compatible_refs[("source", question_id)] = {"role": role, "text": value}
            add(not compatible or previous, "INSERT INTO questions (id,source_id,text,created,note) VALUES (?,?,?,?,?)", values)
            evidence = text(question.get("evidence", ""), 1000, "原文依据")
            confirmed_text = text(question.get("evidence_question", ""), 10000, "依据对应题目")
            if bool(evidence) != bool(confirmed_text) or (evidence and (not evidence.strip() or not confirmed_text.strip())):
                raise ValueError("备份中的原文依据无效")
            if evidence:
                add(not compatible or exists("SELECT 1 FROM question_evidence WHERE question_id=?", (question_id,)),
                    "INSERT INTO question_evidence VALUES (?,?,?,?)", (question_id, evidence, confirmed_text, str(uuid4())))
                if compatible and confirmed_text == value:
                    evidence_questions.add(question_id)
            topic = text(question.get("topic", ""), 100, "主题").strip()
            if topic:
                add(not compatible or exists("SELECT 1 FROM question_topics WHERE kind='source' AND question_id=?", (question_id,)),
                    "INSERT INTO question_topics VALUES ('source',?,?)", (question_id, topic))
    accepted_attempts = set()
    for item in data["attempts"]:
        record(item)
        attempt_id = identifier(item.get("id"))
        unique("attempt", attempt_id)
        values = (attempt_id, text(item.get("question"), 100000, "问题", True), text(item.get("answer"), 100000, "回答"),
                  text(item.get("feedback"), 30000, "点评"), text(item.get("role"), 100000, "岗位"), text(item.get("created"), 100, "时间", True))
        previous = exists("SELECT question,answer,feedback,role,created FROM attempts WHERE id=?", (attempt_id,))
        if not previous or all(previous[key] == item[key] for key in ("question", "answer", "feedback", "role", "created")):
            accepted_attempts.add(attempt_id)
        add(previous, "INSERT INTO attempts VALUES (?,?,?,?,?,?)", values)
    for item in data["drafts"]:
        record(item)
        role = text(item.get("role"), 100, "岗位", True)
        unique("draft", role)
        values = (role, text(item.get("question"), 10000, "问题"), text(item.get("answer"), 30000, "回答"), text(item.get("updated"), 100, "时间", True))
        add(exists("SELECT 1 FROM drafts WHERE role=?", (role,)), "INSERT INTO drafts VALUES (?,?,?,?)", values)
    for item in data["debriefs"]:
        record(item)
        item_id = identifier(item.get("id"))
        unique("debrief", item_id)
        backup_refs.add(("debrief", item_id))
        if type(item.get("include_in_library")) is not int or item["include_in_library"] not in {0, 1}:
            raise ValueError("面试复盘状态无效")
        values = (item_id, text(item.get("role"), 100, "岗位"), text(item.get("company"), 200, "公司"), valid_date(text(item.get("interview_date") or "", 10, "面试日期")),
                  text(item.get("question"), 10000, "问题"), text(item.get("answer"), 30000, "回答"), text(item.get("notes"), 30000, "复盘"),
                  item["include_in_library"], text(item.get("created"), 100, "时间", True))
        if (not item["question"] and not item["notes"]) or (not item["question"] and item["include_in_library"]):
            raise ValueError("面试复盘内容无效")
        previous = exists("SELECT role,question FROM debriefs WHERE id=?", (item_id,))
        add(previous, "INSERT INTO debriefs VALUES (?,?,?,?,?,?,?,?,?)", values)
        topic = text(item.get("topic", ""), 100, "主题").strip()
        if topic and not item["question"]:
            raise ValueError("没有题目的复盘不能标注主题")
        compatible = not previous or (previous["role"] == item["role"] and previous["question"] == item["question"])
        if compatible:
            compatible_refs[("debrief", item_id)] = {"role": item["role"], "text": item["question"]}
        if topic:
            add(not compatible or exists("SELECT 1 FROM question_topics WHERE kind='debrief' AND question_id=?", (item_id,)), "INSERT INTO question_topics VALUES ('debrief',?,?)", (item_id, topic))
    attempts = {item["id"]: item for item in data["attempts"]}
    drafts = {item["role"]: item for item in data["drafts"]}
    details = {identifier(record(item).get("attempt_id")): item for item in data.get("attempt_details", [])}
    links = {identifier(record(item).get("attempt_id")): item for item in data.get("attempt_question_links", [])}
    for item in data.get("assessments", []):
        record(item)
        attempt_id = identifier(item.get("attempt_id"))
        unique("assessment", attempt_id)
        if item.get("rating") not in {"revisit", "comfortable"} or attempt_id not in attempts:
            raise ValueError("备份中的自评无效")
        add(attempt_id not in accepted_attempts or exists("SELECT 1 FROM attempt_assessments WHERE attempt_id=?", (attempt_id,)), "INSERT INTO attempt_assessments VALUES (?,?)", (attempt_id, item["rating"]))
    for item in data.get("attempt_details", []):
        attempt_id = identifier(item.get("attempt_id"))
        unique("attempt_details", attempt_id)
        followup = text(item.get("follow_up"), 2000, "追问")
        parent = text(item.get("parent_attempt_id"), 200, "上轮练习编号")
        if attempt_id not in attempts or (parent and parent not in attempts):
            raise ValueError("追问信息与练习记录不匹配")
        add(attempt_id not in accepted_attempts or (parent and parent not in accepted_attempts) or exists("SELECT 1 FROM attempt_details WHERE attempt_id=?", (attempt_id,)),
            "INSERT INTO attempt_details VALUES (?,?,?)", (attempt_id, followup, parent))
    for item in data.get("draft_contexts", []):
        record(item)
        role = text(item.get("role"), 100, "岗位", True)
        parent = identifier(item.get("parent_attempt_id"))
        unique("draft_context", role)
        draft, detail, attempt = drafts.get(role), details.get(parent), attempts.get(parent)
        if not draft or not detail or not attempt or attempt["role"] != role or detail["follow_up"] != draft["question"].strip():
            raise ValueError("备份中的追问草稿不匹配")
        existing_draft = exists("SELECT question FROM drafts WHERE role=?", (role,))
        existing_detail = exists("SELECT follow_up FROM attempt_details WHERE attempt_id=?", (parent,))
        collision = parent not in accepted_attempts or (existing_draft and existing_draft[0] != draft["question"]) or (existing_detail and existing_detail[0] != detail["follow_up"])
        add(collision or exists("SELECT 1 FROM draft_contexts WHERE role=?", (role,)), "INSERT INTO draft_contexts VALUES (?,?)", (role, parent))
    for item in data.get("attempt_question_links", []):
        record(item)
        attempt_id = identifier(item.get("attempt_id"))
        unique("attempt_question_link", attempt_id)
        kind = item.get("kind")
        question_id = text(item.get("question_id"), 200, "题目编号")
        if kind not in {"source", "debrief", "none", "missing_source", "missing_debrief"} or (bool(question_id) == (kind == "none")):
            raise ValueError("备份中的题目关联无效")
        attempt = attempts.get(attempt_id)
        if not attempt:
            raise ValueError("题目关联缺少练习记录")
        reference = compatible_refs.get((kind, question_id))
        safe = kind == "none" or kind.startswith("missing_") or (reference and reference["role"] == attempt["role"])
        missing = not safe and (kind, question_id) not in backup_refs and kind in {"source", "debrief"}
        stored_kind = kind if safe else "missing_" + kind if missing else "none"
        stored_id = question_id if safe or missing else ""
        add(attempt_id not in accepted_attempts or exists("SELECT 1 FROM attempt_question_links WHERE attempt_id=?", (attempt_id,)), "INSERT INTO attempt_question_links VALUES (?,?,?)", (attempt_id, stored_kind, stored_id))
    for item in data.get("draft_question_links", []):
        record(item)
        role = text(item.get("role"), 100, "岗位", True)
        question_id = identifier(item.get("question_id"))
        unique("draft_question_link", role)
        if item.get("kind") not in {"source", "debrief"} or role not in drafts:
            raise ValueError("备份中的草稿关联无效")
        draft = drafts[role]
        reference = compatible_refs.get((item["kind"], question_id))
        previous = exists("SELECT question,answer,updated FROM drafts WHERE role=?", (role,))
        compatible = not previous or all(previous[key] == draft[key] for key in ("question", "answer", "updated"))
        safe = compatible and reference and reference["role"] == role and reference["text"].strip() == draft["question"].strip()
        add(not safe or exists("SELECT 1 FROM draft_question_links WHERE role=?", (role,)), "INSERT INTO draft_question_links VALUES (?,?,?)", (role, item["kind"], question_id))
    for item in data.get("dialogue_origins", []):
        record(item)
        attempt_id = identifier(item.get("attempt_id"))
        unique("dialogue_origin", attempt_id)
        origin, detail, link = item.get("origin"), details.get(attempt_id), links.get(attempt_id)
        if origin not in {"source", "debrief", "ai", "user"} or attempt_id not in attempts or not detail or detail["parent_attempt_id"] or not link:
            raise ValueError("备份中的对话来源无效")
        if (origin in {"source", "debrief"} and link["kind"] != origin) or (origin in {"ai", "user"} and link["kind"] != "none"):
            raise ValueError("对话来源与题目关联不匹配")
        previous = exists("SELECT kind,question_id FROM attempt_question_links WHERE attempt_id=?", (attempt_id,))
        reference = compatible_refs.get((link["kind"], link["question_id"]))
        source_safe = origin not in {"source", "debrief"} or (reference and reference["role"] == attempts[attempt_id]["role"])
        link_safe = not previous or (previous["kind"] == link["kind"] and previous["question_id"] == link["question_id"])
        add(attempt_id not in accepted_attempts or not source_safe or not link_safe or exists("SELECT 1 FROM dialogue_origins WHERE attempt_id=?", (attempt_id,)), "INSERT INTO dialogue_origins VALUES (?,?)", (attempt_id, origin))
    for item in data.get("dialogue_summaries", []):
        record(item)
        attempt_id = identifier(item.get("attempt_id"))
        unique("dialogue_summary", attempt_id)
        summary = text(item.get("summary"), 10000, "对话总结", True)
        if attempt_id not in attempts or attempt_id not in details:
            raise ValueError("对话总结缺少练习记录")
        add(attempt_id not in accepted_attempts or exists("SELECT 1 FROM dialogue_summaries WHERE attempt_id=?", (attempt_id,)), "INSERT INTO dialogue_summaries VALUES (?,?)", (attempt_id, summary))
    for item in data.get("dialogue_coaching", []):
        record(item)
        attempt_id = identifier(item.get("attempt_id"))
        unique("dialogue_coaching", attempt_id)
        attempt = attempts.get(attempt_id)
        focus, evidence, next_step = (text(item.get(key), maximum, "点评依据", True).strip() for key, maximum in (("focus", 300), ("evidence", 500), ("next_step", 1000)))
        if not attempt or attempt_id not in details or evidence not in attempt["answer"]:
            raise ValueError("备份中的点评依据与回答不匹配")
        add(attempt_id not in accepted_attempts or exists("SELECT 1 FROM dialogue_coaching WHERE attempt_id=?", (attempt_id,)), "INSERT INTO dialogue_coaching VALUES (?,?,?,?)", (attempt_id, focus, evidence, next_step))
    for item in data.get("dialogue_requests", []):
        record(item)
        request_id, attempt_id = identifier(item.get("request_id")), identifier(item.get("attempt_id"))
        unique("dialogue_request", request_id)
        if attempt_id not in attempts or attempt_id not in details:
            raise ValueError("对话请求缺少练习记录")
        add(attempt_id not in accepted_attempts or exists("SELECT 1 FROM dialogue_requests WHERE request_id=?", (request_id,)), "INSERT INTO dialogue_requests VALUES (?,?)", (request_id, attempt_id))
    for item in data.get("ability_evaluations", []):
        record(item)
        attempt_id = identifier(item.get("attempt_id"))
        unique("ability_evaluation", attempt_id)
        attempt = attempts.get(attempt_id)
        if not attempt:
            raise ValueError("能力评价缺少练习记录")
        try:
            evaluation = AbilityEvaluation.model_validate(item.get("evaluation"), context={"question": attempt["question"], "answer": attempt["answer"]}).model_dump(exclude_none=True)
        except ValueError:
            raise ValueError("备份中的能力评价格式无效或证据不匹配") from None
        followup = details.get(attempt_id, {}).get("follow_up", "")
        if evaluation["suggested_followup"] != followup:
            raise ValueError("备份中的能力评价与追问不匹配")
        previous = exists("SELECT follow_up FROM attempt_details WHERE attempt_id=?", (attempt_id,))
        collision = previous and previous[0] != followup
        add(attempt_id not in accepted_attempts or collision or exists("SELECT 1 FROM attempt_ability_evaluations WHERE attempt_id=?", (attempt_id,)),
            "INSERT INTO attempt_ability_evaluations VALUES (?,?)", (attempt_id, json.dumps(evaluation, ensure_ascii=False)))
    plan_tasks(db, data.get("training_tasks", []), unique, add, compatible_refs, accepted_attempts, evidence_questions)
    if commit:
        for query, values in operations:
            db.execute(query, values)
    return counts


def plan_tasks(db, tasks, unique, add, references, attempts, evidence_questions):
    from .career import clean_topics

    states = {"proposed", "searching", "review", "ready", "completed", "failed", "cancelled"}
    for item in tasks:
        record(item)
        task_id = identifier(item.get("id"))
        unique("training_task", task_id)
        role = text(item.get("role"), 100, "岗位", True)
        request_id = identifier(item.get("request_id"))
        unique("training_task_request", (role, request_id))
        if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", request_id, re.I):
            raise ValueError("备份中的训练请求编号无效")
        topic = text(item.get("topic"), 40, "主题")
        point = text(item.get("point"), 200, "知识点")
        topics = item.get("topics")
        if isinstance(topics, str):
            topics = json.loads(topics)
        topics = clean_topics(topics)
        status = item.get("status")
        if status not in states or type(item.get("created_at")) is not int or item["created_at"] < 0:
            raise ValueError("备份中的训练任务状态无效")
        started = item.get("started_at")
        if started is not None and (type(started) is not int or started < 0):
            raise ValueError("备份中的训练时间无效")
        reason = text(item.get("reason", ""), 200, "任务原因")
        result = item.get("result")
        if isinstance(result, str):
            result = json.loads(result)
        if result is not None and not isinstance(result, dict):
            raise ValueError("备份中的训练结果无效")
        question_id, attempt_id, candidate_id = item.get("question_id"), item.get("attempt_id"), item.get("candidate_id")
        for value in (question_id, attempt_id, candidate_id):
            if value is not None:
                identifier(value)
        if status == "searching":
            status, reason, result = "failed", "timeout", None
        if status in {"ready", "completed"}:
            reference = references.get(("source", question_id))
            if not reference or reference["role"] != role or question_id not in evidence_questions:
                status, reason = "failed", "question_removed"
            elif status == "completed" and attempt_id not in attempts:
                status, reason = "failed", "history_conflict"
        if status == "review":
            candidates = result.get("candidates") if result else None
            if not isinstance(candidates, list) or len(candidates) > 128:
                raise ValueError("备份中的待核对候选题无效")
            from .research.source import article_url

            for candidate in candidates:
                record(candidate)
                reviewed_id = identifier(candidate.get("id"))
                if not re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", reviewed_id, re.I):
                    raise ValueError("备份中的候选题编号无效")
                text(candidate.get("question"), 2000, "候选题", True)
                evidence = text(candidate.get("evidence"), 500, "候选题证据", True)
                if len(evidence) < 4 or evidence != evidence.strip():
                    raise ValueError("备份中的候选题证据无效")
                text(candidate.get("title"), 100000, "原帖标题", True)
                text(candidate.get("topic", ""), 40, "主题")
                valid_date(text(candidate.get("date", ""), 10, "原帖日期"))
                if not article_url(candidate.get("url")):
                    raise ValueError("备份中的候选题来源无效")
        existing = db.execute("SELECT 1 FROM training_tasks WHERE id=? OR (role=? AND request_id=?)", (task_id, role, request_id)).fetchone()
        add(existing, """INSERT INTO training_tasks (id,role,request_id,topic,point,topics,status,reason,created_at,started_at,result,candidate_id,question_id,attempt_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (task_id, role, request_id, topic, point, json.dumps(topics, ensure_ascii=False), status, reason,
            item["created_at"], started, json.dumps(result, ensure_ascii=False) if result is not None else None, candidate_id, question_id, attempt_id))
