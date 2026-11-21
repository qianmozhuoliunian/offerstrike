import re
import unicodedata


RAG = {"rag", "检索增强生成", "retrieval-augmented generation", "retrieval augmented generation"}
RETRIEVAL_EVALUATION = {"检索评估", "rag 检索评估", "检索质量评估", "检索效果评估", "评估检索质量", "评估检索效果",
                        "retrieval evaluation", "retrieval quality evaluation"}


def knowledge_key(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).lower().strip())


def topic_key(value):
    key = knowledge_key(value)
    return "rag" if key in RAG else key


def point_key(topic, point):
    key = knowledge_key(point)
    return "检索评估" if topic_key(topic) == "rag" and key in RETRIEVAL_EVALUATION else key


def search_focus(topic, point):
    return "检索评估" if topic_key(topic) == "rag" and point_key(topic, point) == "检索评估" else ""


def matches_rag(text):
    key = knowledge_key(text)
    return bool(re.search(r"(?<![a-z0-9])rag(?![a-z0-9])", key) or any(alias != "rag" and alias in key for alias in RAG))


def matches_focus(focus, text):
    if not focus:
        return True
    key = knowledge_key(text)
    return any(alias in key for alias in RETRIEVAL_EVALUATION) or bool(re.search(
        r"评估\s*(?:(?:rag|检索增强生成)\s*的?\s*)?检索(?:的)?(?:质量|效果|表现)|检索(?:阶段|结果)?(?:的)?(?:质量|效果|表现)(?:应该|可以)?(?:怎么|如何)评估", key))
