import json
import re

from fastapi import Query
from pydantic import Field, field_validator

from .knowledge import point_key, search_focus, topic_key
from .practice import RoleBody, read_dialogue, requirements
from .recommendation import recommend_question
from .research.api import require_role


def is_gap(kind):
    return kind in {"incorrect", "missing"}


def clean_topics(values):
    if not isinstance(values, list) or len(values) > 4 or any(not isinstance(value, str) or not value.strip() or len(value.strip()) > 40 or re.search(r"[\x00-\x1f]", value) for value in values):
        raise ValueError("主题最多 4 个，每个 1 至 40 字，请使用可公开的关键词")
    return list(dict.fromkeys(value.strip() for value in values))


def requirement_topics(value):
    lines = [re.sub(r"^\s*[•*-]\s*", "", line).strip() for line in re.split(r"[\n；;]+", value)]
    return list(dict.fromkeys(line for line in lines if line and len(line) <= 40 and not re.search(r"[,，]", line)))[:4]


def ability_history(db, role):
    recent = db.execute("""SELECT a.id AS attempt_id,a.question,a.answer,a.created,e.evaluation,
        COALESCE(d.parent_attempt_id,'') AS parent_attempt_id FROM attempts a
        JOIN attempt_ability_evaluations e ON e.attempt_id=a.id LEFT JOIN attempt_details d ON d.attempt_id=a.id
        WHERE a.role=? ORDER BY a.created DESC,a.rowid DESC LIMIT 100""", (role,)).fetchall()
    cache = {}

    def original_question(attempt_id):
        cursor = attempt_id
        topic = ""
        topic_attempt = None
        for _turn in range(8):
            if cursor not in cache:
                cache[cursor] = db.execute("""SELECT COALESCE(d.parent_attempt_id,'') AS parent,l.kind,l.question_id,
                    json_extract(e.evaluation,'$.topic') AS topic,t.topic AS library_topic FROM attempts a
                    LEFT JOIN attempt_details d ON d.attempt_id=a.id LEFT JOIN attempt_question_links l ON l.attempt_id=a.id
                    LEFT JOIN question_topics t ON t.kind=l.kind AND t.question_id=l.question_id
                    LEFT JOIN attempt_ability_evaluations e ON e.attempt_id=a.id WHERE a.id=? AND a.role=?""", (cursor, role)).fetchone()
            row = cache[cursor]
            if not row:
                break
            if not topic and isinstance(row["topic"], str) and row["topic"]:
                topic, topic_attempt = row["topic"], cursor
            if not row["parent"]:
                return {"root_attempt_id": cursor, "question_ref": {"kind": row["kind"], "id": row["question_id"]} if row["question_id"] else None,
                        "topic": topic, "topic_attempt_id": topic_attempt, "library_topic": row["library_topic"] or ""}
            cursor = row["parent"]
        return {"root_attempt_id": None, "question_ref": None, "topic": topic, "topic_attempt_id": topic_attempt, "library_topic": ""}

    history = []
    answers = {}
    for row in recent:
        value = dict(row)
        answers[value["attempt_id"]] = value.pop("answer")
        value["evaluation"] = json.loads(value["evaluation"])
        history.append({**value, **original_question(value["attempt_id"])})
    points = {}
    topics = {}
    for row in history:
        topic = row["topic"]
        value = row["evaluation"]
        if not isinstance(value, dict):
            continue
        if topic:
            key = topic_key(topic)
            topics.setdefault(key, {"topic": topic, "rounds": 0, "last_seen": row["created"]})["rounds"] += 1
        items = {}
        strength_list = value.get("strengths") if isinstance(value.get("strengths"), list) else []
        weakness_list = value.get("weaknesses") if isinstance(value.get("weaknesses"), list) else []
        unverified_list = value.get("unverified") if isinstance(value.get("unverified"), list) else []
        entries = [{**item, "type": "correct"} for item in strength_list if isinstance(item, dict)]
        entries += [item for item in weakness_list if isinstance(item, dict)]
        entries += [{"point": point, "type": "unverified"} for point in unverified_list if isinstance(point, str)]
        for item in entries:
            point = item.get("point")
            kind = item.get("type")
            if not isinstance(point, str) or not point.strip() or kind not in {"correct", "incorrect", "missing", "unverified"}:
                continue
            if kind != "unverified" and (not isinstance(item.get("evidence"), str) or not item["evidence"] or item["evidence"] not in answers[row["attempt_id"]]):
                continue
            if kind == "missing" and (not isinstance(item.get("requirement"), str) or not item["requirement"] or item["requirement"] not in row["question"]):
                continue
            key = point_key(topic, point)
            if key not in items:
                items[key] = item
            elif items[key] and kind != "unverified" and items[key]["type"] != kind:
                items[key] = None
        for item in items.values():
            if not item:
                continue
            point, kind = item["point"], item["type"]
            key = (topic_key(topic), point_key(topic, point))
            if key not in points:
                points[key] = {"topic": topic, "point": point, "latest": kind, "last_seen": row["created"],
                    "last_attempt_id": row["attempt_id"], "correct": 0, "incorrect": 0, "missing": 0, "unverified": 0, "observations": []}
            observation = points[key]
            observation[kind] += 1
            observation["observations"].append({"attempt_id": row["attempt_id"], "root_attempt_id": row["root_attempt_id"],
                "question_ref": row["question_ref"], "library_topic": row["library_topic"], "created": row["created"],
                "question": row["question"], "kind": kind, "evidence": item.get("evidence", ""),
                "requirement": item.get("requirement", ""), "raw_point": point})
    observations = []
    for value in points.values():
        item = dict(value)
        timeline = item.pop("observations")
        assessed = [record for record in timeline if record["kind"] != "unverified"]
        latest_assessed = assessed[0]["kind"] if assessed else None
        first_correct = next((index for index, record in enumerate(assessed) if record["kind"] == "correct"), -1)
        gap_rounds = (len(assessed) if first_correct < 0 else first_correct) if is_gap(latest_assessed) else 0
        first_gap = next((index for index, record in enumerate(assessed) if is_gap(record["kind"])), -1)
        supported = assessed[:first_gap if first_gap >= 0 else len(assessed)] if latest_assessed == "correct" else []
        supporting_sessions = len({record["root_attempt_id"] or record["attempt_id"] for record in supported})
        if latest_assessed == "correct" and first_gap > 0:
            change = "improving"
            comparison = assessed[first_gap]
        elif gap_rounds and first_correct > 0:
            change = "needs_review_again"
            comparison = assessed[first_correct]
        else:
            change = "consistent" if len(assessed) > 1 else "insufficient"
            comparison = None
        evidence = assessed[:3 if comparison else 4]
        if comparison and comparison not in evidence:
            evidence.append(comparison)
        observations.append({**item, "latest_assessed": latest_assessed, "gap_rounds": gap_rounds,
            "supporting_sessions": supporting_sessions, "change": change, "evidence": evidence,
            "supported_questions": list(dict.fromkeys(record["question_ref"]["id"] for record in supported if record["question_ref"]))})
    issues = sorted((item for item in observations if is_gap(item["latest_assessed"])),
                    key=lambda item: (-item["gap_rounds"], -int(item["latest_assessed"] == "incorrect")))
    recurring = [item for item in issues if item["gap_rounds"] >= 2]
    next_steps = {}
    for item in recurring + issues:
        if item["topic"] and topic_key(item["topic"]) not in next_steps:
            next_steps[topic_key(item["topic"])] = {"topic": item["topic"], "point": item["point"], "action": "review", "attempt_id": item["evidence"][0]["attempt_id"]}
        if len(next_steps) == 4:
            break
    return {"history": history, "topics": list(topics.values()), "recurring_issues": recurring, "next_steps": list(next_steps.values()),
            "profile": {"role": role, "points": observations},
            "repeated_strengths": [item for item in observations if item["latest_assessed"] == "correct" and item["correct"] >= 2],
            "unverified": [item for item in observations if item["latest"] == "unverified"]}


def pending_followup(db, role, history, selected):
    if not history:
        return None
    row = history[0]
    evaluation = row["evaluation"]
    if not isinstance(evaluation, dict) or evaluation.get("recommended_action") != "followup":
        return None
    if selected and not any(topic_key(topic) in {topic_key(row["topic"]), topic_key(row["library_topic"])} for topic in selected):
        return None
    latest = db.execute("SELECT id FROM attempts WHERE role=? ORDER BY created DESC,rowid DESC LIMIT 1", (role,)).fetchone()
    if not latest or latest[0] != row["attempt_id"] or not db.execute("SELECT 1 FROM dialogue_origins WHERE attempt_id=?", (row["root_attempt_id"],)).fetchone():
        return None
    dialogue = read_dialogue(db, role, row["attempt_id"])
    question = dialogue["turns"][-1]["follow_up"]
    if not dialogue["can_continue"] or question != evaluation.get("suggested_followup"):
        return None
    point = evaluation.get("followup_point")
    item = next((item for item in evaluation.get("weaknesses", []) if item.get("point") == point), None)
    if not item:
        return None
    return {"action": "followup", "topic": row["topic"], "point": point,
        "reason": "最近一次作答有值得核对的薄弱点，可以继续本题的一道追问。",
        "followup": {"parent_attempt_id": row["attempt_id"], "question": question},
        "evidence": [{"attempt_id": row["attempt_id"], "created": row["created"], "question": row["question"],
                      "kind": item["type"], "evidence": item["evidence"], "requirement": item.get("requirement", "")}]}


def career_plan(db, role, value):
    jd_topics = requirement_topics(requirements(db, role))
    rows = [dict(row) for row in db.execute("""SELECT a.id,a.created,aa.rating,t.topic FROM attempts a
        JOIN attempt_assessments aa ON aa.attempt_id=a.id JOIN attempt_question_links l ON l.attempt_id=a.id
        JOIN question_topics t ON t.kind=l.kind AND t.question_id=l.question_id WHERE a.role=?
        ORDER BY a.created DESC,a.id DESC LIMIT 100""", (role,))]
    recent = {}
    for row in reversed(rows):
        recent[row["topic"].lower()] = row
    recent_topics = [row["topic"] for row in reversed(list(recent.values())) if row["rating"] == "revisit"]
    selected = list({topic_key(topic): topic for topic in clean_topics(value.get("topics", []))}.values())
    mock = value.get("mode") == "mock"
    ability = None if mock else ability_history(db, role)
    issues = ability["recurring_issues"] + [item for item in ability["profile"]["points"] if is_gap(item["latest_assessed"])] if ability else []
    weak_ids = {record["question_ref"]["id"] for item in issues for record in item["evidence"] if is_gap(record["kind"]) and record["question_ref"]}
    strengths = [item for item in ability["profile"]["points"] if item["supporting_sessions"] >= 2] if ability else []
    deprioritized = [question_id for item in strengths for question_id in item["supported_questions"] if question_id not in weak_ids]
    if selected:
        topics = selected
    elif mock:
        topics = []
    else:
        names = [item["topic"] for item in issues] + recent_topics + jd_topics + [item["topic"] for item in strengths if item["topic"]]
        topics = list({topic_key(topic): topic for topic in names}.values())[:4]
    completed = [item for item in value.get("completed", []) if isinstance(item, str)][:30]
    options = {"exclude_ids": completed if mock else [], "deprioritized_ids": deprioritized, "max_length": 2000}
    available = recommend_question(db, role, **options)

    def practice_task(topic, question, hint=""):
        reduced = question["selfAssessment"] != "revisit" and any(ref["id"] in deprioritized for ref in question["questionRefs"])
        strength = next((item for item in strengths if any(ref["id"] in item["supported_questions"] for ref in question["questionRefs"])), None) if reduced else None
        previous = db.execute("SELECT id AS attempt_id,question,created FROM attempts WHERE role=? AND id=?", (role, question["lastAttemptId"])).fetchone() if question["lastAttemptId"] else None
        evidence = strength["evidence"][:4] if strength else [{**dict(previous), "kind": question["selfAssessment"], "evidence": ""}] if previous else []
        return {"action": "practice", "topic": topic, "reason": hint + ("多次独立作答已有正确证据，降低重复优先级。" if strength else question["reason"]),
                "question": question, "point": strength["point"] if strength else "", "evidence": evidence,
                "change": strength["change"] if strength else None, "lower_priority": bool(strength)}

    tasks = []
    for topic in topics or [""]:
        issue = next((item for item in issues if topic_key(topic) in {topic_key(item["topic"]), topic_key(item["evidence"][0]["library_topic"] or item["topic"])}), None)
        evidence = issue["evidence"][:min(issue["gap_rounds"], 3)] if issue else []
        ref = evidence[0]["question_ref"] if evidence else None
        linked = recommend_question(db, role, **options, question_ref=ref) if ref else None
        focus = search_focus(topic, issue["point"]) if issue else ""
        question = linked or (recommend_question(db, role, **options, topic=topic, focus=focus) if topic else None if issue else available)
        if issue:
            hint = f'同一知识点连续 {issue["gap_rounds"]} 轮出现错误或遗漏。' if issue["gap_rounds"] > 1 else "最近一次有证据的作答出现错误。" if issue["latest_assessed"] == "incorrect" else "最近一次有证据的作答遗漏了题目要求。"
        else:
            hint = "对应已确认的岗位要求。" if not mock and any(topic_key(item) == topic_key(topic) for item in jd_topics) else ""
        basis = {"point": issue["point"] if issue else "", "evidence": evidence, "change": issue["change"] if issue else None}
        if not question:
            tasks.append({"action": "research", "topic": topic, "reason": hint + ("本场未找到其他符合条件的题。" if mock and completed else "当前岗位的题库缺少这类题，可以补搜。"),
                          **basis, "research_request": {"role": role, "topics": [topic] if topic else []}})
        elif issue:
            tasks.append({"action": "review", "topic": topic, "reason": hint + ("回到关联原题复习。" if linked else "用题库中同主题的题补练。"), "question": question, **basis})
        else:
            tasks.append(practice_task(topic, question, hint))
    if not selected and not mock and available and (not any(task.get("question") for task in tasks)
            or (available["availability"] == "new" and not any(task.get("question", {}).get("availability") == "new" for task in tasks))):
        tasks.append(practice_task("", available))

    def rank(task):
        question = task.get("question", {})
        if task["action"] == "review":
            return -1
        if question.get("selfAssessment") == "revisit":
            return 0
        if question.get("availability") == "new":
            return 1
        if task.get("lower_priority"):
            return 5
        if question.get("selfAssessment") == "unassessed":
            return 2
        return 3 if task["action"] == "research" else 4

    tasks.sort(key=rank)
    followup = pending_followup(db, role, ability["history"], selected) if ability else None
    if followup:
        tasks.insert(0, followup)
    return {"tasks": tasks, "has_requirements": bool(requirements(db, role)), "profile": ability["profile"] if ability else None}


class PlanInput(RoleBody):
    topics: list[str] = Field(default_factory=list, max_length=4)
    mode: str = ""
    completed: list[str] = Field(default_factory=list)
    exclude_question: str = ""
    source_preference: str = ""

    @field_validator("topics")
    @classmethod
    def check_topics(cls, values):
        return clean_topics(values)


def install_career(app, transaction):
    @app.get("/api/career/ability-history")
    def history(role: str = Query(max_length=100), db=transaction):
        require_role(db, role)
        return ability_history(db, role)

    @app.post("/api/career/plan")
    def plan(value: PlanInput, db=transaction):
        require_role(db, value.role)
        return career_plan(db, value.role, value.model_dump())

    @app.post("/api/recommendation")
    def recommendation(value: PlanInput, db=transaction):
        return {"question": recommend_question(db, value.role, value.exclude_question, value.source_preference)}
