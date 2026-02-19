from __future__ import annotations

import hashlib
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha1_hex(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def strip_html(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[’']", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "unknown"


def parse_rfc3339_or_rfc822_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    # Try RFC3339-ish first.
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%fZ",
    ):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        except ValueError:
            pass

    # Try common RSS pubDate formats (RFC822-like).
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M %z",
    ):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        except ValueError:
            pass
    return None


@dataclass(frozen=True)
class FetchResult:
    status: int
    url: str
    content: bytes | None
    etag: str | None
    last_modified: str | None


def fetch_url(
    url: str,
    *,
    timeout_seconds: int,
    user_agent: str,
    if_none_match: str | None = None,
    if_modified_since: str | None = None,
) -> FetchResult:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme in ("file", ""):
        file_path = Path(urllib.request.url2pathname(parsed.path if parsed.scheme == "file" else url))
        content = file_path.read_bytes()
        return FetchResult(
            status=200,
            url=url,
            content=content,
            etag=None,
            last_modified=None,
        )

    headers = {"User-Agent": user_agent}
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    if if_modified_since:
        headers["If-Modified-Since"] = if_modified_since

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            content = resp.read()
            return FetchResult(
                status=getattr(resp, "status", 200),
                url=resp.geturl(),
                content=content,
                etag=resp.headers.get("ETag"),
                last_modified=resp.headers.get("Last-Modified"),
            )
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return FetchResult(status=304, url=url, content=None, etag=None, last_modified=None)
        raise


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _find_child_text(elem: ET.Element, names: Iterable[str]) -> str | None:
    wanted = set(names)
    for child in list(elem):
        if _local_name(child.tag) in wanted:
            # Some feeds use nested XHTML in <content>; itertext preserves it.
            text = "".join(child.itertext()) if child is not None else ""
            text = text.strip()
            if text:
                return text
    return None


def _find_first_attr_url(elem: ET.Element, names: Iterable[str], attr: str) -> str | None:
    for child in list(elem):
        if _local_name(child.tag) in names:
            value = child.attrib.get(attr)
            if value:
                return value
    return None


def _find_rss_image_url(channel: ET.Element) -> str | None:
    # Prefer iTunes-style <itunes:image href="..."> (local name is "image").
    url = _find_first_attr_url(channel, ("image",), "href")
    if url:
        return url.strip()

    # RSS-style:
    # <image>
    #   <url>https://...</url>
    # </image>
    for child in list(channel):
        if _local_name(child.tag) != "image":
            continue
        for sub in list(child):
            if _local_name(sub.tag) != "url":
                continue
            text = (sub.text or "").strip()
            if text:
                return text
    return None


def _abs_url(base: str, url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    if not url:
        return None
    try:
        return urllib.parse.urljoin(base, url)
    except Exception:
        return url


def _looks_like_image_url(url: str | None) -> bool:
    if not url:
        return False
    u = url.lower()
    return any(u.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")) or "imgix" in u


def _find_item_image_url(item: ET.Element, *, base_url: str | None = None) -> str | None:
    # Prefer iTunes-style item art: <itunes:image href="..."/>
    url = _find_first_attr_url(item, ("image",), "href")
    if url:
        return _abs_url(base_url or "", url)

    # media:thumbnail url="..."
    url = _find_first_attr_url(item, ("thumbnail",), "url")
    if url:
        return _abs_url(base_url or "", url)

    # media:content url="..." type="image/*" medium="image"
    for child in list(item):
        if _local_name(child.tag) != "content":
            continue
        u = child.attrib.get("url") or child.attrib.get("href")
        typ = (child.attrib.get("type") or "").lower()
        med = (child.attrib.get("medium") or "").lower()
        if med == "image" or typ.startswith("image/") or _looks_like_image_url(u):
            if u:
                return _abs_url(base_url or "", u)

    # RSS-style item <image><url>...</url></image> (rare)
    for child in list(item):
        if _local_name(child.tag) != "image":
            continue
        for sub in list(child):
            if _local_name(sub.tag) != "url":
                continue
            text = (sub.text or "").strip()
            if text:
                return _abs_url(base_url or "", text)

    return None


def parse_feed(xml_bytes: bytes, *, source_url: str) -> dict[str, Any]:
    root = ET.fromstring(xml_bytes)
    root_name = _local_name(root.tag).lower()

    if root_name == "rss":
        return _parse_rss(root, source_url=source_url)
    if root_name == "feed":
        return _parse_atom(root, source_url=source_url)

    # Some feeds use RDF (rss 1.0); handle the common parts similarly.
    if root_name in ("rdf", "rdf:rdf"):
        return _parse_rdf(root, source_url=source_url)

    raise ValueError(f"Unsupported feed root element: {root.tag}")


def _parse_rss(root: ET.Element, *, source_url: str) -> dict[str, Any]:
    channel = next((c for c in list(root) if _local_name(c.tag) == "channel"), None)
    if channel is None:
        raise ValueError("RSS feed missing <channel>")

    title = _find_child_text(channel, ("title",)) or source_url
    link = _find_child_text(channel, ("link",)) or source_url
    description = _find_child_text(channel, ("description", "subtitle")) or ""
    image_url = _find_rss_image_url(channel)

    items = []
    for item in list(channel):
        if _local_name(item.tag) != "item":
            continue
        items.append(_parse_rss_item(item, base_url=source_url))

    return {
        "version": 1,
        "type": "rss",
        "source_url": source_url,
        "title": strip_html(title),
        "link": link,
        "description": strip_html(description),
        "image_url": image_url,
        "items": items,
    }


def _parse_rss_item(item: ET.Element, *, base_url: str) -> dict[str, Any]:
    title = strip_html(_find_child_text(item, ("title",)) or "")
    link = _find_child_text(item, ("link",))
    guid = _find_child_text(item, ("guid", "id"))
    pub_date = parse_rfc3339_or_rfc822_date(_find_child_text(item, ("pubDate", "published", "updated", "date")))
    # Prefer the richest description we can find (content:encoded is commonly the long-form).
    # Namespace local names: <content:encoded> -> "encoded", <itunes:summary> -> "summary".
    desc_candidates = [
        _find_child_text(item, ("encoded",)),
        _find_child_text(item, ("summary",)),
        _find_child_text(item, ("description",)),
    ]
    best = ""
    for c in desc_candidates:
        c = strip_html(c or "")
        if len(c) > len(best):
            best = c
    description = best

    enclosure_url = None
    enclosure_type = None
    enclosure_length = None
    for child in list(item):
        if _local_name(child.tag) == "enclosure":
            enclosure_url = child.attrib.get("url") or enclosure_url
            enclosure_type = child.attrib.get("type") or enclosure_type
            enclosure_length = child.attrib.get("length") or enclosure_length
            break

    itunes_duration = None
    for child in list(item):
        if _local_name(child.tag) == "duration":
            itunes_duration = child.text
            break

    if (not link) and guid and guid.strip().lower().startswith(("http://", "https://")):
        link = guid.strip()

    image_url = _find_item_image_url(item, base_url=base_url)

    return {
        "title": title,
        "link": link,
        "guid": guid,
        "published_at": pub_date,
        "description": description,
        "image_url": image_url.strip() if isinstance(image_url, str) and image_url.strip() else None,
        "enclosure_url": enclosure_url,
        "enclosure_type": enclosure_type,
        "enclosure_length": enclosure_length,
        "itunes_duration": normalize_ws(itunes_duration) if itunes_duration else None,
    }


def _parse_atom(root: ET.Element, *, source_url: str) -> dict[str, Any]:
    title = strip_html(_find_child_text(root, ("title",)) or source_url)
    description = strip_html(_find_child_text(root, ("subtitle", "tagline")) or "")

    link = source_url
    for child in list(root):
        if _local_name(child.tag) == "link":
            rel = (child.attrib.get("rel") or "alternate").lower()
            if rel == "alternate" and child.attrib.get("href"):
                link = child.attrib["href"]
                break

    items = []
    for entry in list(root):
        if _local_name(entry.tag) != "entry":
            continue
        items.append(_parse_atom_entry(entry, base_url=source_url))

    image_url = None
    logo = (_find_child_text(root, ("logo", "icon")) or "").strip()
    if logo:
        image_url = logo
    else:
        image_url = _find_first_attr_url(root, ("image",), "href")

    return {
        "version": 1,
        "type": "atom",
        "source_url": source_url,
        "title": title,
        "link": link,
        "description": description,
        "image_url": image_url.strip() if isinstance(image_url, str) and image_url.strip() else None,
        "items": items,
    }


def _parse_atom_entry(entry: ET.Element, *, base_url: str) -> dict[str, Any]:
    title = strip_html(_find_child_text(entry, ("title",)) or "")
    guid = _find_child_text(entry, ("id", "guid"))

    link = None
    enclosure_url = None
    enclosure_type = None
    for child in list(entry):
        if _local_name(child.tag) != "link":
            continue
        rel = (child.attrib.get("rel") or "alternate").lower()
        if rel == "alternate" and not link and child.attrib.get("href"):
            link = child.attrib["href"]
        if rel == "enclosure" and child.attrib.get("href"):
            enclosure_url = child.attrib.get("href")
            enclosure_type = child.attrib.get("type")

    if (not link) and guid and guid.strip().lower().startswith(("http://", "https://")):
        link = guid.strip()

    published_at = parse_rfc3339_or_rfc822_date(
        _find_child_text(entry, ("published", "updated", "pubDate", "date"))
    )
    summary = strip_html(_find_child_text(entry, ("summary", "content")) or "")

    image_url = _find_item_image_url(entry, base_url=base_url)

    return {
        "title": title,
        "link": link,
        "guid": guid,
        "published_at": published_at,
        "description": summary,
        "image_url": image_url.strip() if isinstance(image_url, str) and image_url.strip() else None,
        "enclosure_url": enclosure_url,
        "enclosure_type": enclosure_type,
        "enclosure_length": None,
        "itunes_duration": None,
    }


def _parse_rdf(root: ET.Element, *, source_url: str) -> dict[str, Any]:
    channel = next((c for c in list(root) if _local_name(c.tag) == "channel"), None)
    title = strip_html(_find_child_text(channel, ("title",)) if channel is not None else None) or source_url
    link = _find_child_text(channel, ("link",)) if channel is not None else None
    description = strip_html(_find_child_text(channel, ("description",)) if channel is not None else None) or ""
    image_url = _find_rss_image_url(channel) if channel is not None else None

    items = []
    for item in list(root):
        if _local_name(item.tag) != "item":
            continue
        items.append(_parse_rss_item(item, base_url=source_url))

    return {
        "version": 1,
        "type": "rdf",
        "source_url": source_url,
        "title": title,
        "link": link or source_url,
        "description": description,
        "image_url": image_url.strip() if isinstance(image_url, str) and image_url.strip() else None,
        "items": items,
    }


_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "has",
    "have",
    "he",
    "her",
    "his",
    "i",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "our",
    "she",
    "that",
    "the",
    "their",
    "they",
    "this",
    "to",
    "was",
    "we",
    "were",
    "with",
    "you",
    "your",
    # Common podcast boilerplate.
    "episode",
    "episodes",
    "trailer",
    "bonus",
    "part",
    "live",
    "interview",
}


def extract_speakers(text: str) -> list[str]:
    """
    Heuristic extraction tuned for podcast titles/descriptions.
    Goal: "good enough" cross-feed guest linking, not perfect NER.
    """
    raw = strip_html(text or "")
    if not raw:
        return []

    normalized = normalize_ws(raw)
    candidates: list[str] = []
    patterns = [
        r"\bwith\s+([A-Z][^|–—\n]{0,120})",
        r"\b(featuring|feat\.|ft\.)\s+([A-Z][^|–—\n]{0,120})",
        r"\bguest(?:s)?\s*:\s*([A-Z][^|–—\n]{0,120})",
    ]
    for pat in patterns:
        m = re.search(pat, normalized, flags=re.IGNORECASE)
        if not m:
            continue
        group = m.group(m.lastindex or 1)
        # Cut off common "descriptor" separators that often follow the guest name.
        # Include ellipsis used by some feeds in descriptions ("…").
        group = re.split(r"(?:\s+(?:-|–|—|\||:)\s+|[.\n\u2026])", group, maxsplit=1)[0]
        candidates.extend(_split_name_list(group))

    if not candidates:
        # Fallback: scan for capitalized 2-4 word sequences in the title line only.
        title_line = normalize_ws(raw.splitlines()[0] if raw.splitlines() else raw)
        head = title_line[:220]
        for m in re.finditer(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b", head):
            candidates.append(m.group(1))

    blocked_words = {
        "Featuring",
        "Episode",
        "Trailer",
        "Bonus",
        "Part",
        "Live",
        "Interview",
        "Featuring:",
    }

    cleaned: list[str] = []
    seen = set()
    for c in candidates:
        c = normalize_ws(c)
        if not c or len(c) < 4:
            continue
        if len(c) > 45:
            continue
        if len(c.split()) < 2:
            continue
        if any(w.lower() in _STOPWORDS for w in c.split()):
            continue
        if any(w in blocked_words for w in c.split()):
            continue
        if c.lower() in ("episode", "bonus episode", "part one", "part two"):
            continue
        if re.search(r"https?://", c, flags=re.IGNORECASE):
            continue
        if re.search(r"\d", c):
            continue
        if "/" in c or "@" in c:
            continue
        # Avoid clearly "sentence fragments".
        if any(ch in c for ch in (".", "!", "?", "•", "…")):
            continue
        key = c.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(c)

    return cleaned[:8]


def _split_name_list(value: str) -> list[str]:
    value = normalize_ws(value)
    value = re.sub(r"\s*\(.*?\)\s*", " ", value)
    parts = re.split(r"\s*(?:,|&| and | with )\s*", value)
    out = []
    for p in parts:
        p = normalize_ws(p)
        if not p:
            continue
        # Strip trailing punctuation.
        p = re.sub(r"[.!?;:\u2026]+$", "", p).strip()
        out.append(p)
    return out


def extract_topics(text: str) -> list[str]:
    text = normalize_ws(strip_html(text)).lower()
    if not text:
        return []
    words = [re.sub(r"[^a-z0-9]+", "", w) for w in text.split()]
    words = [
        w
        for w in words
        if len(w) >= 5
        and w not in _STOPWORDS
        and not w.isdigit()
        and not w.startswith("http")
        and "www" not in w
    ]
    # Keep order but de-dupe.
    out: list[str] = []
    seen = set()
    for w in words:
        if len(w) > 30:
            continue
        if w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out[:10]


def sanitize_speakers(names: list[str] | None) -> list[str]:
    if not names:
        return []
    out: list[str] = []
    seen = set()

    strip_chars = " \t\r\n-–—|:;,.!?\"“”‘’'()[]{}<>•…"
    allowed_inline = set(" -'’")
    blocked_tokens = {
        "ep",
        "eps",
        "episode",
        "episodes",
        "epsiode",
        "rewind",
        "series",
        "podcast",
        "tm",
    }

    def _normalize_token(token: str) -> str:
        t = token.strip(strip_chars)
        # Drop lingering wrappers.
        t = re.sub(r"^[^\w]+|[^\w]+$", "", t, flags=re.UNICODE)
        return t

    def _clean_candidate(value: str) -> str:
        # Normalize dashes to hyphen, and treat "dash with spaces" as a hard separator.
        s = value.replace("–", "-").replace("—", "-").replace("‑", "-").replace("‐", "-")
        s = re.split(r"(?:\.\.\.+|\u2026)", s, maxsplit=1)[0]
        # Names should not contain hyphens with spaces around them; treat as a word separator.
        s = re.sub(r"\s+-\s+", " ", s)
        # Replace punctuation with whitespace; keep hyphen/apostrophes.
        buf = []
        for ch in s:
            if ch.isalpha() or ch in (" ", "-", "'", "’"):
                buf.append(ch)
            else:
                buf.append(" ")
        s = normalize_ws("".join(buf))
        s = s.strip(strip_chars)
        return s

    def _token_ok(t: str) -> bool:
        if not t:
            return False
        if len(t) == 1:
            return False
        if t.lower() in blocked_tokens:
            return False
        if any(ch.isdigit() for ch in t):
            return False
        for ch in t:
            if ch.isalpha() or ch in ("'", "’", "-"):
                continue
            return False
        if t.lower() in _STOPWORDS:
            return False
        return True

    def _tokens_ok(tokens: list[str]) -> bool:
        if len(tokens) < 2 or len(tokens) > 4:
            return False
        if sum(len(t) for t in tokens) > 45:
            return False
        for t in tokens:
            if not _token_ok(t):
                return False
        return True

    def _norm_caps_token(token: str) -> str:
        # Canonicalize all-caps tokens so speaker keys don't fragment across feeds/titles.
        # Keep short acronyms (<=2) as-is (e.g. "DJ").
        def _cap_seg(seg: str) -> str:
            if not seg:
                return seg
            if len(seg) <= 2:
                return seg
            if seg.isupper():
                return seg[0].upper() + seg[1:].lower()
            return seg

        # Split on hyphens, then apostrophes, but preserve separators.
        parts: list[str] = []
        for i, hy in enumerate(token.split("-")):
            if i:
                parts.append("-")
            ap_parts: list[str] = []
            buf = ""
            for ch in hy:
                if ch in ("'", "’"):
                    if buf:
                        ap_parts.append(_cap_seg(buf))
                        buf = ""
                    ap_parts.append(ch)
                else:
                    buf += ch
            if buf:
                ap_parts.append(_cap_seg(buf))
            parts.extend(ap_parts)
        return "".join(parts)

    for raw in names:
        s = normalize_ws(strip_html(str(raw)))
        s = _clean_candidate(s)
        s = s.strip(strip_chars)
        s = re.sub(r"^[\s\-\u2013\u2014|:]+", "", s)
        s = re.sub(r"[\s\-\u2013\u2014|:]+$", "", s)
        s = re.sub(r"^[^\w]+|[^\w]+$", "", s, flags=re.UNICODE)
        s = re.sub(r"(’s|'s)$", "", s)
        if not s:
            continue
        if len(s) > 45:
            continue
        if re.search(r"https?://", s, flags=re.IGNORECASE):
            continue

        # First pass: strict validation on the string tokens.
        parts = [_normalize_token(p) for p in s.split()]
        parts = [p for p in parts if p]

        salvage = False
        if parts and parts[0] and parts[0][0].islower():
            salvage = True

        if salvage or (not _tokens_ok(parts)):
            # Salvage: if the candidate contains descriptors, prefer the tail 2-4 tokens.
            for n in (2, 3, 4):
                if len(parts) >= n and _tokens_ok(parts[-n:]):
                    parts = parts[-n:]
                    break
            else:
                continue

        # Final allowed-char check (spaces + hyphen/apostrophes only).
        parts = [_norm_caps_token(p) for p in parts]
        joined = " ".join(parts)
        if any((not ch.isalpha()) and (ch not in allowed_inline) for ch in joined):
            continue
        key = joined.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(joined)
    return out[:8]


def sanitize_topics(topics: list[str] | None) -> list[str]:
    if not topics:
        return []
    out: list[str] = []
    seen = set()
    for raw in topics:
        s = normalize_ws(strip_html(str(raw))).lower()
        if not s:
            continue
        if len(s) < 4 or len(s) > 30:
            continue
        if s.startswith("http") or s.startswith("www") or "http" in s or "www" in s:
            continue
        if s in _STOPWORDS:
            continue
        if s.isdigit():
            continue
        if not re.fullmatch(r"[a-z0-9][a-z0-9 -]*[a-z0-9]", s):
            continue
        key = s
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out[:10]


def stable_episode_key(*, guid: str | None, enclosure_url: str | None, title: str, published_at: str | None) -> str:
    basis = guid or enclosure_url or f"{title}|{published_at or ''}"
    return sha1_hex(basis)


def sleep_seconds(seconds: float) -> None:
    # Centralized for potential future jitter/backoff.
    if seconds > 0:
        time.sleep(seconds)


def format_bytes(num: int) -> str:
    n = float(max(0, int(num or 0)))
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(n)} {unit}"
            return f"{n:.2f} {unit}"
        n /= 1024
    return f"{n:.2f} TB"


def path_stats(path: Path) -> dict[str, int]:
    """
    Lightweight recursive disk usage for a file or directory.
    Returns: {"files": <count>, "bytes": <total_bytes>}
    """
    try:
        if not path.exists():
            return {"files": 0, "bytes": 0}
        if path.is_file():
            return {"files": 1, "bytes": int(path.stat().st_size)}
    except Exception:
        return {"files": 0, "bytes": 0}

    total_files = 0
    total_bytes = 0
    try:
        for p in path.rglob("*"):
            try:
                if not p.is_file():
                    continue
                total_files += 1
                total_bytes += int(p.stat().st_size)
            except Exception:
                continue
    except Exception:
        return {"files": 0, "bytes": 0}

    return {"files": total_files, "bytes": total_bytes}


def path_stats_tree(root: Path, *, exclude_dir_names: set[str] | None = None) -> dict[str, int]:
    """
    Recursive disk usage for a directory, with directory-name exclusions.
    Exclusions apply at any depth (e.g. "node_modules", ".git").
    """
    if not root.exists():
        return {"files": 0, "bytes": 0}
    if root.is_file():
        return path_stats(root)

    exclude = set(exclude_dir_names or set())
    total_files = 0
    total_bytes = 0

    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        # Prune excluded directories.
        if exclude and dirnames:
            dirnames[:] = [d for d in dirnames if d not in exclude]
        for name in filenames:
            try:
                p = Path(dirpath) / name
                if not p.is_file():
                    continue
                total_files += 1
                total_bytes += int(p.stat().st_size)
            except Exception:
                continue

    return {"files": total_files, "bytes": total_bytes}
