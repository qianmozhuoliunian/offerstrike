import json
import logging
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, Field, StrictStr, ValidationInfo, model_validator


logger = logging.getLogger("offerstrike.interview")
EVALUATION_INSTRUCTIONS = """只返回一个合法 JSON 对象，在外层字段之外增加 evaluation 键。evaluation 是嵌套评价对象，无法判断时可填 null。
evaluation 的字段为 topic、strengths、weaknesses、unverified、followup_point、recommended_action。topic 使用原文中出现的主题词，未知填空字符串。strengths 每项只含 point 和 evidence。weaknesses 每项含 point、evidence、type，type 为 incorrect 或 missing，missing 项还须包含 requirement。unverified 是尚未验证知识点的字符串列表。
每类优先选择最重要的 1 至 2 项，列表上限为 4 项，输出前检查数量。point 使用中性知识点名称。不从单轮推断掌握水平。所有 evidence 必须逐字摘自本轮回答。missing 的 requirement 必须逐字摘自本题明确要求，point 必须直接对应该要求中的具体事项。用户主动提及而题目没有要求展开的内容归入 unverified，不能判为明确遗漏或认定用户不会。
recommended_action 为 followup、review 或 complete。值得澄清的本轮薄弱点才使用 followup，followup_point 原样复制一条 weaknesses.point，外层 follow_up 提供一道具体相关追问。其余行动 followup_point 与 follow_up 均为空。"""


def canonical(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip().lower())


def question_key(value):
    return "".join(character for character in canonical(value) if not character.isspace() and not unicodedata.category(character).startswith("P"))


class Observation(BaseModel):
    point: StrictStr = Field(min_length=1, max_length=200)
    evidence: StrictStr = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def check_answer(self, info: ValidationInfo):
        self.point = self.point.strip()
        if (not self.point or self.evidence != self.evidence.strip()
                or not self.evidence.strip() or self.evidence not in info.context["answer"]):
            raise ValueError("invalid_evaluation")
        return self


class Weakness(Observation):
    type: Literal["incorrect", "missing"]
    requirement: StrictStr | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def check_requirement(self, info: ValidationInfo):
        if self.type == "missing" and (not self.requirement or self.requirement != self.requirement.strip()
                or self.requirement not in info.context["question"]):
            raise ValueError("invalid_evaluation")
        return self


class AbilityEvaluation(BaseModel):
    topic: StrictStr = Field(max_length=40)
    strengths: list[Observation] = Field(max_length=4)
    weaknesses: list[Weakness] = Field(max_length=4)
    unverified: list[StrictStr] = Field(max_length=4)
    followup_point: StrictStr = Field(max_length=200)
    suggested_followup: StrictStr = Field(max_length=500)
    recommended_action: Literal["followup", "review", "complete"]

    @model_validator(mode="after")
    def check_consistency(self, info: ValidationInfo):
        self.topic = self.topic.strip()
        if self.topic and not any(canonical(self.topic) in canonical(text) for text in (info.context["question"], info.context["answer"])):
            raise ValueError("invalid_evaluation")
        self.unverified = [point.strip() for point in self.unverified]
        if any(not point or len(point) > 200 for point in self.unverified):
            raise ValueError("invalid_evaluation")
        points = [item.point for item in self.strengths + self.weaknesses] + self.unverified
        if not points or len({canonical(point) for point in points}) != len(points):
            raise ValueError("invalid_evaluation")
        self.followup_point = self.followup_point.strip()
        self.suggested_followup = self.suggested_followup.strip()
        if self.recommended_action == "followup":
            if not question_key(self.suggested_followup) or not any(item.point == self.followup_point for item in self.weaknesses):
                raise ValueError("invalid_evaluation")
        elif self.followup_point or self.suggested_followup:
            raise ValueError("invalid_evaluation")
        return self


def model_evaluation(response, question, answer):
    value = response.get("evaluation")
    if value is None:
        return None
    try:
        if not isinstance(value, dict):
            raise ValueError()
        value = dict(value)
        topic = value.get("topic")
        if isinstance(topic, str) and len(topic) <= 40 and topic and not any(canonical(topic) in canonical(text) for text in (question, answer)):
            token = re.match(r"^([A-Z][A-Z0-9]{1,11})(?=\s|[:：])", topic)
            value["topic"] = token[1] if token and token[1] in re.findall(r"[A-Za-z0-9]+", question + " " + answer) else ""
        value.setdefault("suggested_followup", "")
        if value.get("recommended_action") == "followup":
            followup = value["suggested_followup"] or response.get("follow_up")
            selected = isinstance(value.get("weaknesses"), list) and any(isinstance(item, dict) and item.get("point") == value.get("followup_point") for item in value["weaknesses"])
            if (not selected or not isinstance(followup, str) or not followup.strip() or len(followup) > 500
                    or re.search(r"[\r\n]", followup) or len(re.findall(r"[?？]", followup)) > 1):
                value.update(recommended_action="review", followup_point="", suggested_followup="")
                logger.warning("Unusable follow-up, preserving grounded observations")
            else:
                value["suggested_followup"] = followup
        evaluation = AbilityEvaluation.model_validate(value, context={"question": question, "answer": answer})
        result = evaluation.model_dump(exclude_none=True)
        for item in result["weaknesses"]:
            if item["type"] == "incorrect":
                item.pop("requirement", None)
        return result
    except (ValueError, TypeError, KeyError):
        logger.warning("Invalid structured evaluation, preserving natural-language feedback")
        return None


def apply_evaluation(review, evaluation, asked, can_follow=True):
    result = {**review, "evaluation": evaluation}
    if evaluation is None:
        result["follow_up"] = review["follow_up"] if can_follow else ""
    elif evaluation["recommended_action"] != "followup":
        result["follow_up"] = ""
    elif can_follow and all(question_key(question) != question_key(evaluation["suggested_followup"]) for question in asked):
        result["follow_up"] = evaluation["suggested_followup"]
    else:
        result["follow_up"] = ""
        result["evaluation"] = {**evaluation, "followup_point": "", "suggested_followup": "", "recommended_action": "review"}
    return result


def save_evaluation(db, attempt_id, evaluation):
    if evaluation is not None:
        db.execute("INSERT INTO attempt_ability_evaluations VALUES (?,?)", (attempt_id, json.dumps(evaluation, ensure_ascii=False)))


def read_evaluation(db, attempt_id):
    row = db.execute("SELECT evaluation FROM attempt_ability_evaluations WHERE attempt_id=?", (attempt_id,)).fetchone()
    return json.loads(row[0]) if row else None
