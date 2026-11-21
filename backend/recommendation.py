import math
import re
import time
from datetime import datetime, timezone

from .app import list_sources
from .knowledge import knowledge_key, matches_focus, matches_rag, topic_key


INTERVALS = {"revisit": 1, "unassessed": 3, "comfortable": 7}


def timestamp(value, default=None):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc).timestamp() * 1000 if parsed.tzinfo is None else parsed.timestamp() * 1000
    except (ValueError, TypeError, AttributeError):
        return default


def library_candidates(db, role, source_preference=""):
    if source_preference not in {"", "self_reported"}:
        raise ValueError("题目来源筛选无效")
    candidates = []
    for source in list_sources(db):
        if source["role"] != role or (source_preference == "self_reported" and source["type"] != "真实面经（自述）"):
            continue
        for question in source["questions"]:
            candidates.append({"role": role, "text": question["text"], "question_ref": {"kind": "source", "id": question["id"]},
                "questionCreated": question["created"], "topic": question["topic"], "sourceId": source["id"],
                "sourceTitle": source["title"], "sourceUrl": source["url"], "sourceDate": source["date"],
                "sourceType": source["type"], "interviewDate": source["interview_date"]})
    if source_preference != "self_reported":
        rows = db.execute("""SELECT d.*,COALESCE(t.topic,'') AS topic FROM debriefs d LEFT JOIN question_topics t
            ON t.kind='debrief' AND t.question_id=d.id WHERE d.role=? AND d.include_in_library=1""", (role,))
        for row in rows:
            candidates.append({"role": role, "text": row["question"], "question_ref": {"kind": "debrief", "id": row["id"]},
                "questionCreated": row["created"], "topic": row["topic"], "sourceId": "debrief:" + row["id"],
                "sourceTitle": "个人面试记录", "sourceType": "个人面试记录"})
    return candidates


def recommend_question(db, role, exclude_text="", source_preference="", *, topic="", exclude_ids=None,
                       question_ref=None, deprioritized_ids=None, max_length=math.inf, focus=""):
    if not isinstance(role, str) or not role.strip() or len(role) > 100:
        raise ValueError("请先设置目标岗位")
    exclude_ids = exclude_ids or []
    deprioritized_ids = deprioritized_ids or []
    pool = library_candidates(db, role, source_preference)
    excluded_text = {knowledge_key(item["text"]) for item in pool if item["question_ref"]["id"] in exclude_ids}
    key = topic_key(topic)
    topic_word = re.compile(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])") if re.fullmatch(r"[a-z0-9]+", key) else None
    grouped = {}
    for item in pool:
        text = item["text"].strip()
        if (not text or len(text) > max_length or knowledge_key(text) in excluded_text
                or (question_ref and item["question_ref"] != question_ref) or not matches_focus(focus, text)):
            continue
        topic_matches = not key or topic_key(item["topic"]) == key
        if not topic_matches:
            if key == "rag":
                topic_matches = matches_rag(text)
            elif topic_word:
                topic_matches = bool(topic_word.search(knowledge_key(text)))
            else:
                topic_matches = key in knowledge_key(text)
        if not topic_matches:
            continue
        if text not in grouped:
            grouped[text] = {**item, "text": text, "sources": [], "topics": [], "questionRefs": []}
        group = grouped[text]
        if item["question_ref"] not in group["questionRefs"]:
            group["questionRefs"].append(item["question_ref"])
        source = {"id": item.get("sourceId", ""), "title": item.get("sourceTitle") or "来源未知",
                  "url": item.get("sourceUrl", ""), "date": item.get("sourceDate", ""), "type": item.get("sourceType") or "来源未知",
                  "interviewDate": item.get("interviewDate", "")}
        if not any(existing["id"] == source["id"] if source["id"] else existing == source for existing in group["sources"]):
            group["sources"].append(source)
        if item["topic"] and item["topic"] not in group["topics"]:
            group["topics"].append(item["topic"])
    if not grouped:
        return None
    attempts = [dict(row) for row in db.execute("""SELECT a.*,aa.rating,l.kind AS refKind,l.question_id AS refId FROM attempts a
        LEFT JOIN attempt_assessments aa ON aa.attempt_id=a.id LEFT JOIN attempt_question_links l ON l.attempt_id=a.id WHERE a.role=?""", (role,))]
    by_reference = {}
    legacy_by_text = {}
    for attempt in attempts:
        kind = attempt["refKind"]
        if kind == "none":
            continue
        if kind:
            by_reference.setdefault((kind, attempt["refId"]), []).append(attempt)
        else:
            legacy_by_text.setdefault(attempt["question"].strip(), []).append(attempt)
    ranked = []
    current = time.time() * 1000
    for index, question in enumerate(grouped.values()):
        refs = question["questionRefs"]
        question["question_ref"] = refs[0] if refs else None
        question["sourceTitle"] = question["sources"][0]["title"]
        question["sourceUrl"] = question["sources"][0]["url"]
        records = [attempt for ref in refs for attempt in by_reference.get((ref["kind"], ref["id"]), [])]
        created = timestamp(question.get("questionCreated"))
        if len(refs) <= 1:
            for attempt in legacy_by_text.get(question["text"], []):
                attempted = timestamp(attempt["created"])
                if created is None or (attempted is not None and created <= attempted):
                    records.append(attempt)
        records.sort(key=lambda item: (timestamp(item["created"], -math.inf), item["id"]), reverse=True)
        latest = records[0] if records else None
        rating = latest["rating"] if latest and latest["rating"] in {"revisit", "comfortable"} else "unassessed"
        last_time = timestamp(latest["created"]) if latest else None
        age = max(0, math.floor((current - last_time) / 86400000)) if last_time is not None else None
        due = age is not None and age >= INTERVALS[rating]
        repeated = rating != "revisit" and any(ref["id"] in deprioritized_ids for ref in refs)
        if repeated:
            rank = 7
        elif not latest:
            rank = 1
        elif due:
            rank = {"revisit": 0, "unassessed": 2, "comfortable": 3}[rating]
        else:
            rank = {"revisit": 4, "unassessed": 5, "comfortable": 6}[rating]
        reason = "尚未练习" if not latest else "你标记为需要再练" if rating == "revisit" else "你标记为比较熟悉" if rating == "comfortable" else "练习后尚未自评"
        recent = "最近练习时间未知" if age is None else "今天练习过" if age == 0 else f"{age} 天前练习过"
        details = "可以先试答，尚未练习不代表不会。" if not latest else f"{recent}，共练习 {len(records)} 次。"
        if latest:
            details += "已到建议复习时间。" if due else f"建议间隔 {INTERVALS[rating]} 天。" if age is not None else ""
            if any(not attempt["refKind"] for attempt in records):
                details += "部分旧记录按文字匹配，来源未核实。"
        availability = "new" if not latest else "unknown" if age is None else "due" if due else "early"
        value = {**question, "reason": reason, "reasonDetails": details, "practiceCount": len(records),
                 "lastAttemptId": latest["id"] if latest else None,
                 "lastPracticedAt": datetime.fromtimestamp(last_time / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") if last_time is not None else "",
                 "selfAssessment": rating, "availability": availability,
                 "sameAsCurrent": bool(exclude_text.strip()) and question["text"] == exclude_text.strip()}
        ranked.append({"question": value, "rank": rank, "count": len(records), "last": last_time, "index": index})
    ranked.sort(key=lambda item: (item["rank"], item["count"], item["last"] if item["last"] is not None else math.inf, item["index"]))
    other = next((item for item in ranked if item["question"]["text"] != exclude_text.strip() and item["question"]["availability"] in {"new", "due"}), None)
    selected = other or next((item for item in ranked if exclude_text.strip() and item["question"]["text"] == exclude_text.strip()), None) or ranked[0]
    return selected["question"]
