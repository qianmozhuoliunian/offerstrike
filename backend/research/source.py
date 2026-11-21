import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit

import httpx


MAX_BYTES = 512 * 1024
MAX_ARTICLE_CHARS = 6000
IGNORED = {"script", "style", "template", "iframe", "noscript", "nav", "footer", "aside"}
BLOCKS = {"p", "li", "pre", "br", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


def published_date(value):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    match = re.match(r"^(\d{4}-\d{2}-\d{2})(?:$|T)", value)
    try:
        if match:
            return date.fromisoformat(match[1]).isoformat()
        if re.fullmatch(r"[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT", value):
            return parsedate_to_datetime(value).astimezone(timezone.utc).date().isoformat()
    except ValueError:
        pass
    return ""


def article_url(value):
    try:
        url = urlsplit(value)
        if url.scheme != "https" or url.username or url.password or url.port not in {None, 443}:
            return None
        if url.hostname in {"www.nowcoder.com", "m.nowcoder.com"} and re.fullmatch(r"/discuss/[0-9]{10,20}", url.path):
            return "https://www.nowcoder.com" + url.path
        if url.hostname == "www.cnblogs.com" and re.fullmatch(r"/[\w-]+/p/(?:[\w-]+\.html|\d+)", url.path, flags=re.ASCII):
            return urlunsplit(("https", "www.cnblogs.com", url.path, "", ""))
    except (ValueError, TypeError):
        pass
    return None


@dataclass(eq=False)
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)
    text: str = ""


class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(Node("#text", text=data))


def walk(node):
    if node.tag in IGNORED:
        return
    yield node
    for child in node.children:
        yield from walk(child)


def tidy(text):
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_article(html, *, url, detail=None):
    parser = ArticleParser()
    parser.feed(html)
    nodes = list(walk(parser.root))
    article = parser.root if detail is not None else next((node for node in nodes if node.attrs.get("id") == "cnblogs_post_body"), None)
    if article is None:
        raise ValueError("source_unavailable")
    sections = [{"heading": "", "text": "", "level": 0}]

    def append(node, in_heading=False):
        if node.tag in IGNORED:
            return
        heading = re.fullmatch(r"h([1-6])", node.tag)
        if heading:
            sections.append({"heading": "", "text": "", "level": int(heading[1])})
        if node.tag == "#text":
            sections[-1]["text"] += node.text
            if in_heading:
                sections[-1]["heading"] += node.text
        if node.tag in BLOCKS:
            sections[-1]["text"] += "\n"
        for child in node.children:
            append(child, in_heading or bool(heading))
        if node.tag in BLOCKS:
            sections[-1]["text"] += "\n"

    append(article)
    text = ""
    headings = []
    for section in sections:
        content = tidy(section["text"])
        if not content:
            continue
        if text:
            text += "\n\n"
        heading = tidy(section["heading"])
        if heading:
            headings.append({"start": len(text), "text": heading, "level": section["level"]})
        text += content
    if not text:
        raise ValueError("source_unavailable")
    title_node = next((node for node in nodes[:nodes.index(article)] if node.attrs.get("id") == "cb_post_title_url"), None) if detail is None else None
    title = tidy(detail["title"]) if detail else tidy("".join(node.text for node in walk(title_node))) if title_node else ""
    meta = next((node.attrs.get("content", "") for node in nodes if node.tag == "meta" and node.attrs.get("property") == "article:published_time"), "")
    posted = next((node for node in nodes if node.attrs.get("id") == "post-date"), None)
    raw_date = meta or ("".join(node.text for node in walk(posted)).strip().replace(" ", "T") if posted else "")
    if detail:
        stamp = detail.get("createTime")
        # Ported from the MIT InterviewRadar connector. See THIRD_PARTY_NOTICES.md.
        if isinstance(stamp, (int, float)) and not isinstance(stamp, bool) and math.isfinite(stamp) and stamp > 0:
            try:
                raw_date = datetime.fromtimestamp(stamp if stamp < 10000000000 else stamp / 1000, timezone.utc).isoformat()
            except (ValueError, OverflowError, OSError):
                raw_date = ""
        else:
            raw_date = ""
    clipped = text[:MAX_ARTICLE_CHARS]
    return {"url": url, "text": clipped, "date": published_date(raw_date), "truncated": len(clipped) < len(text),
            "title": title if len(title) <= 300 else "",
            "headings": [heading for heading in headings if heading["start"] + len(heading["text"]) <= len(clipped)]}


async def read_article(client: httpx.AsyncClient, value):
    safe = article_url(value)
    if not safe:
        raise ValueError("unsupported_source")
    nowcoder = safe.startswith("https://www.nowcoder.com/")
    endpoint = "https://gw-c.nowcoder.com/api/sparta/detail/content-data/detail/" + safe.rsplit("/", 1)[1] if nowcoder else safe
    async with client.stream("GET", endpoint, timeout=9, headers={
        "accept": "application/json" if nowcoder else "text/html", "user-agent": "OfferStrikeResearch/1.0",
    }) as response:
        expected_type = "application/json" if nowcoder else "text/html"
        if response.status_code != 200 or response.headers.get("content-type", "").split(";")[0].lower() != expected_type:
            raise ValueError("source_unavailable")
        if int(response.headers.get("content-length", "0")) > MAX_BYTES:
            raise ValueError("source_too_large")
        chunks = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("source_too_large")
            chunks.append(chunk)
    html = b"".join(chunks).decode("utf-8", errors="replace")
    detail = None
    if nowcoder:
        import json

        data = json.loads(html)
        detail = data.get("data")
        if (data.get("success") is not True or not isinstance(detail, dict)
                or detail.get("id") != safe.rsplit("/", 1)[1]
                or not isinstance(detail.get("title"), str) or not detail["title"].strip()):
            raise ValueError("source_unavailable")
        html = detail.get("richText") or detail.get("content")
        if not isinstance(html, str) or not html.strip():
            raise ValueError("source_unavailable")
    return parse_article(html, url=safe, detail=detail)
