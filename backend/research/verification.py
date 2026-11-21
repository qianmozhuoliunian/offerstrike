"""Port of the existing scoped company and literal evidence checks."""

import json
import re
import unicodedata


def normalized(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value).lower()) if isinstance(value, str) else ""


def verifiable(value, text):
    return (isinstance(value, str) and value == value.strip() and 4 <= len(value) <= 500
            and len(value.encode("utf-16-le")) // 2 <= 1000 and value in text)


def contains_keyword(text, term):
    if re.fullmatch(r"[a-z0-9+#.\-]+", term):
        return bool(re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text))
    return term in text


def role_matcher(role):
    role_text = normalized(re.sub(r"<[^>]*>", "", role))
    pieces = re.findall(r"[a-z][a-z0-9+#.]*(?:-?[a-z0-9]+)*|[\u3400-\u9fff]+", role_text)
    terms = []
    for piece in pieces:
        term = piece
        if re.search(r"[\u3400-\u9fff]", piece):
            term = re.sub(r"^(?:资深|高级|中级|初级|应届|校招|社招|暑期|实习)+", "", term)
            if term.endswith("分析师"):
                term = term[:-1]
            else:
                term = re.sub(r"(?:工程师|设计师|架构师|程序员|实习生|经理|专员|代表|助理|顾问|主管|总监|岗位|实习)$", "", term)
            term = re.sub(r"(?:开发|研发)$", "", term)
        if len(term) >= 2:
            terms.append(term)
    specific = [term for term in terms if term not in {"ai", "应用", "技术", "开发", "研发", "工程"}]
    keywords = list(dict.fromkeys(specific or terms))

    def matches(value):
        text = normalized(re.sub(r"<[^>]*>", "", value))
        return bool((role_text and contains_keyword(text, role_text)) or any(contains_keyword(text, term) for term in keywords))

    return matches


REPOST = re.compile(r"转载自|转自[:：]|(?:本文|本篇|以下(?:内容|面经)?)(?:为|系|是)?转载|(?:转载|转发)(?:了)?(?:他人|别人|网友|朋友|同学|面经)")
OTHER_INTERVIEWEE = re.compile(r"(?:朋友|同学|同事|网友|他人|原作者)(?:的|分享的)(?:面经|面试经历)|(?:我(?:的)?(?:朋友|同学|同事)|网友|原作者)(?:在|去)[^。！？!?；;]{0,24}(?:面试|[一二三四五六]面)")
UNCERTAIN = re.compile(r"疑似|可能|大概|不确定|待确认|听说|据说|如果|假如|是否")
COMPARISON = re.compile(r"对比|比较|相比|相较|区别|\bvs\b")
ROUND_HEADING = re.compile(r"^(?:技术|业务|综合|hr)?(?:[一二三四五六七八九十1-9]面|第[一二三四五六七八九十1-9]轮|初面|终面|复试)(?:\(\d+(?:min|分钟)\)|:\d{1,4}(?:[./-]\d{1,2}){0,2})?$")
DECLARED_COMPANY = re.compile(r"^(?:更正[:：])?(?:我|本人)(?:这次|本次)?(?:面试|面)的(?:公司)?是([^,，:：()]+)")
TEXT_HEADING = re.compile(r"^[^,，。!?？:：]{2,45}(?:[一二三四五六七八九十1-9]面|面试记录|面试经历|面经)(?:\([^)]{1,30}\))?$")
REPORT_CUE = re.compile(r"面试官(?:问|提问|追问|让我)|(?:我|本人).{0,24}(?:面试|一面|二面|三面|被问)|(?:面试|一面|二面|三面).{0,24}(?:问我|让我)")
QUESTION_CUE = re.compile(r"[？?]$|^(?:什么|如何|为什么|怎么|请(?:介绍|解释|说明)|说说|谈谈|介绍|解释|讲讲|实现|对比)")


def clauses(text):
    return [normalized(clause) for clause in re.split(r"[。!?；;\n]", unicodedata.normalize("NFKC", text))]


def has_text_heading(text):
    return any(ROUND_HEADING.search(normalized(block)) or TEXT_HEADING.search(normalized(block)) for block in text.split("\n\n"))


def company_attribution(company, quote, scopes, context, chapter=""):
    target = normalized(company)
    if not target:
        return "unknown"
    name = re.escape(target)
    denies = re.compile(
        rf"(?:不是|并非|而非|非)(?:在|去|参加|面试)?{name}|"
        rf"(?:没有|没|未|不曾)(?:在|去|参加过?|面试过?|面过){name}|"
        rf"不在{name}|{name}(?:的面试)?(?:我|本人)?(?:没|没有|未|不曾)(?:去|参加|面试|面过)"
    )
    article_context = [clause for item in context for clause in clauses(item)]
    if any(denies.search(clause) for clause in article_context):
        return "negative"
    for clause in article_context:
        stated = DECLARED_COMPANY.search(clause)
        if ((stated and stated[1] != target and not stated[1].startswith(target + "的"))
                or REPOST.search(clause) or OTHER_INTERVIEWEE.search(clause)):
            return "unknown"
    if chapter and quote == chapter and normalized(chapter) == target:
        return "affirmative"
    anchors = [scope for scope in scopes if verifiable(quote, scope)]
    if not anchors or target not in normalized(quote):
        return "unknown"
    interview = r"(?:面试|[一二三四五六七八九十1-9]面|初面|终面|复试|面经)"
    detail = r"[^,，:：、]{0,28}"
    subject = r"(?:我|本人)(?:本次|这次)?"
    affirmative = re.compile(
        rf"^(?:【|\[)?{name}{detail}{interview}(?:经历|记录|回顾|总结)?(?:[】\]]|\([^)]{{1,30}}\))?$|"
        rf"{subject}(?:在|到|去|参加(?:了|过)?|应聘(?:了|过)?){name}{detail}{interview}|"
        rf"{subject}(?:面试|面)(?:了|的(?:公司)?是){name}(?:$|[的,，:：(（])"
    )
    multiple = re.compile(rf"{name}(?:和|与|或|以及|及|、|/|vs)|(?:和|与|或|以及|及|、|/|vs){name}")
    relevant = [clause for anchor in anchors for clause in clauses(anchor) if target in clause]
    if any(UNCERTAIN.search(clause) for clause in relevant):
        return "unknown"
    if any(not COMPARISON.search(clause) and not multiple.search(clause) and affirmative.search(clause) for clause in relevant):
        return "affirmative"
    return "mentioned"


def verify_candidates(content, body, *, role, company):
    parsed = json.loads(content)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list) or len(parsed["items"]) > 5:
        raise ValueError("invalid_extraction")
    text = body["text"]
    headings = body.get("headings", [])
    first = headings[0] if headings else None
    intro_end = len(text)
    if first:
        if first["start"] == 0 and first["level"] == 1:
            if len(headings) > 1:
                intro_end = headings[1]["start"]
        else:
            intro_end = first["start"]
    intro = text[:intro_end]
    matches_role = role_matcher(role)
    seen = set()
    accepted = []
    for item in parsed["items"]:
        if not isinstance(item, dict):
            continue
        evidence = item.get("evidence")
        evidence = evidence.strip() if isinstance(evidence, str) else None
        if not verifiable(evidence, text) or "\n\n" in evidence or text.count(evidence) != 1:
            continue
        start = text.index(evidence)
        end = start + len(evidence)
        previous_break = text.rfind("\n\n", 0, max(0, start))
        paragraph_end = text.find("\n\n", start)
        paragraph = text[previous_break + 2 if previous_break >= 0 else 0:paragraph_end if paragraph_end >= 0 else len(text)]
        section_index = next((index for index in range(len(headings) - 1, -1, -1) if headings[index]["start"] <= start), -1)
        section_heading = headings[section_index] if section_index >= 0 else None
        next_heading = headings[section_index + 1] if section_index + 1 < len(headings) else None
        if next_heading and end > next_heading["start"]:
            continue
        section_start = section_heading["start"] if section_heading else 0
        section = text[section_start:next_heading["start"] if next_heading else len(text)]
        report = item.get("report_evidence")
        if not verifiable(report, section) or not REPORT_CUE.search(report):
            continue
        heading = section_heading["text"] if section_heading else ""
        chapter = None
        if section_heading and ROUND_HEADING.search(normalized(heading)) and not has_text_heading(text[section_start + len(heading):start]):
            chapter = next((ancestor for ancestor in reversed(headings[:section_index]) if ancestor["level"] < section_heading["level"]), None)
        chapter_index = headings.index(chapter) if chapter else -1
        chapter_lead = text[chapter["start"]:headings[chapter_index + 1]["start"]] if chapter else ""
        lead = section[len(heading):].strip().split("\n\n", 1)[0]
        context = [intro, chapter_lead, section]
        scopes = [paragraph, heading, chapter["text"] if chapter else ""]
        if company and re.match(r"^(?:我|本人)", lead):
            lead_end = section_start + section.index(lead, len(heading)) + len(lead)
            if not has_text_heading(text[lead_end:start]) and company_attribution(company, lead, [lead], []) == "affirmative":
                scopes.append(lead)
        company_quote = item.get("company_evidence")
        if company and company_attribution(company, company_quote, scopes, context, chapter["text"] if chapter else "") != "affirmative":
            continue
        role_quote = item.get("role_evidence")
        role_in_body = any(verifiable(role_quote, scope) for scope in scopes)
        title = body.get("title", "")
        role_from_title = (not role_in_body and bool(company) and verifiable(role_quote, title)
                           and company_attribution(company, title, [title], [title]) == "affirmative")
        if (not role_in_body and not role_from_title) or not matches_role(role_quote):
            continue
        without_list = re.sub(r"^(?:[-*]\s+|[0-9一二三四五六七八九十]+[.、)）]\s*|\d+-\s*)", "", evidence)
        question = re.sub(r"^(?:面试官(?:问(?:了我)?|提问|让我)|追问)[：:]\s*", "", without_list).strip()
        if not question or (not QUESTION_CUE.search(question) and without_list == evidence and question == without_list):
            continue
        key = re.sub(r"[？?。]+$", "", normalized(question))
        if key in seen:
            continue
        seen.add(key)
        result = {"question": question, "evidence": evidence, "role_evidence": role_quote,
                  "company_evidence": company_quote if company else None,
                  "evidence_location": {"paragraph": len(text[:start].split("\n\n")), "start": start, "end": end}}
        if role_from_title:
            result["role_evidence_basis"] = "article_title"
        accepted.append(result)
    return accepted
