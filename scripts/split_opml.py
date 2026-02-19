from __future__ import annotations

import argparse
import html
import json
import ipaddress
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from scripts.shared import REPO_ROOT, slugify


TTRPG_KW = re.compile(
    r"\b("
    r"ttrpg|actual\s*play|role\s*playing|roleplaying|tabletop\s*rpg|"
    r"dnd|d&d|dungeons?\s*(?:&|and)?\s*dragons?|"
    r"pathfinder|starfinder|call\s+of\s+cthulhu|cthulhu|delta\s+green|"
    r"m[öo]rk\s+borg|pirate\s+borg|daggerheart|blades\s+in\s+the\s+dark|"
    r"shadowrun|warhammer|cyberpunk|vampire\s+the\s+masquerade"
    r")\b",
    re.IGNORECASE,
)

FICTION_KW = re.compile(
    r"\b("
    r"audio\s*dramas?|radio\s*dramas?|fiction|audiobooks?|audio\s*books?|"
    r"narrative\s+fiction|serial\s+fiction|radio\s+plays?|tales?"
    r")\b",
    re.IGNORECASE,
)

ACTUALPLAY_SYSTEMS: list[tuple[str, re.Pattern[str]]] = [
    ("ttrpg/dnd", re.compile(r"\b(dnd|d&d|dungeons?\s*(?:&|and)?\s*dragons?|5e)\b", re.IGNORECASE)),
    ("ttrpg/pathfinder", re.compile(r"\bpathfinder\b", re.IGNORECASE)),
    ("ttrpg/starfinder", re.compile(r"\bstarfinder\b", re.IGNORECASE)),
    ("ttrpg/call-of-cthulhu", re.compile(r"\b(call\s+of\s+cthulhu|cthulhu)\b", re.IGNORECASE)),
    ("ttrpg/delta-green", re.compile(r"\bdelta\s+green\b", re.IGNORECASE)),
    ("ttrpg/blades-in-the-dark", re.compile(r"\bblades\s+in\s+the\s+dark\b", re.IGNORECASE)),
    ("ttrpg/mork-borg", re.compile(r"\bm[öo]rk\s+borg\b", re.IGNORECASE)),
    ("ttrpg/pirate-borg", re.compile(r"\bpirate\s+borg\b", re.IGNORECASE)),
    ("ttrpg/shadowrun", re.compile(r"\bshadowrun\b", re.IGNORECASE)),
    ("ttrpg/warhammer", re.compile(r"\bwarhammer\b", re.IGNORECASE)),
    ("ttrpg/cyberpunk", re.compile(r"\bcyberpunk\b", re.IGNORECASE)),
    ("ttrpg/vtm", re.compile(r"\bvampire\s+the\s+masquerade\b", re.IGNORECASE)),
    ("ttrpg/daggerheart", re.compile(r"\bdaggerheart\b", re.IGNORECASE)),
]

OTHER_HINTS: list[tuple[str, re.Pattern[str]]] = [
    ("comedy", re.compile(r"\b(comedy|comedian|jokes)\b", re.IGNORECASE)),
    ("comedy", re.compile(r"\b(taskmaster|off\s+menu|rhlstp|adam\s+buxton|horne\s+section|jimmy\s+carr)\b", re.IGNORECASE)),
    ("comedy", re.compile(r"\b(class\s+clown|perfect\s+day|mom\s+can'?t\s+cook|mark\s+simmons|lip\s+service)\b", re.IGNORECASE)),
    ("music", re.compile(r"\b(music|jazz|celtic)\b", re.IGNORECASE)),
    ("science", re.compile(r"\b(nature|science)\b", re.IGNORECASE)),
    ("politics", re.compile(r"\bpolitics\b", re.IGNORECASE)),
    ("news", re.compile(r"\b(news|private\s+eye)\b", re.IGNORECASE)),
    ("fiction", re.compile(r"\b(fiction|audiobook|audio\s*book|audio\s*drama|radio\s*drama|radio\s*play|short\s+stories|plays?)\b", re.IGNORECASE)),
    ("fiction", re.compile(r"\b(sherlock|poirot|judge\s+dredd|twilight\s+zone)\b", re.IGNORECASE)),
    ("games", re.compile(r"\b(gaming|games?|pixels|firelink|quest|heroes|adventure)\b", re.IGNORECASE)),
    ("hobbies", re.compile(r"\bwoodturn\w*\b", re.IGNORECASE)),
    ("language", re.compile(r"\b(cymraeg|welsh)\b", re.IGNORECASE)),
]


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Split a Podcast Republic OPML export into two feeds configs.")
    p.add_argument("opml", help="Path to OPML file (e.g. podcasts_YYYY_MM_DD_..opml)")
    p.add_argument("--out-actualplays", default="feeds.actualplays.json", help="Output config for TTRPG/story feeds.")
    p.add_argument("--out-other", default="feeds.other.json", help="Output config for all other subscriptions.")
    p.add_argument("--out-local", default="feeds.local.json", help="Output config for local-network feeds.")
    return p.parse_args()


def _unescape_repeat(text: str) -> str:
    s = str(text or "")
    for _ in range(4):
        ns = html.unescape(s)
        if ns == s:
            break
        s = ns
    return s


def _norm_ws(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _opml_category_parts(feed: OpmlFeed) -> list[str]:
    raw = str(feed.category or "")
    if not raw:
        return []
    parts: list[str] = []
    for part in raw.split(","):
        part = _norm_ws(_unescape_repeat(part)).strip().strip("/")
        if not part:
            continue
        parts.append(part)
    # Dedup while preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        k = p.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def _add_cat(out: list[str], cat: str) -> None:
    c = str(cat or "").strip().strip("/")
    if not c:
        return
    c = c.lower()
    if c in out:
        return
    out.append(c)


def _categories_actualplays(feed: OpmlFeed) -> list[str]:
    cats: list[str] = []
    parts = [p.lower() for p in _opml_category_parts(feed)]
    hay = (feed.title + " " + feed.path).lower()

    is_ttrpg = any("ttrpg" in p for p in parts) or bool(TTRPG_KW.search(hay))
    is_story = any(("audiobooks" in p) or ("drama" in p) for p in parts) or bool(FICTION_KW.search(hay))

    if is_ttrpg:
        _add_cat(cats, "ttrpg")
        _add_cat(cats, "ttrpg/actual-play")
        if re.search(r"\bsolo\b", hay, flags=re.IGNORECASE):
            _add_cat(cats, "ttrpg/solo")
        for cat, rx in ACTUALPLAY_SYSTEMS:
            if rx.search(hay):
                _add_cat(cats, cat)

    if is_story and (not is_ttrpg):
        _add_cat(cats, "fiction")
    if is_story and is_ttrpg:
        _add_cat(cats, "fiction")

    if re.search(r"\bbbc\b", hay, flags=re.IGNORECASE) and re.search(r"\bradio\b", hay, flags=re.IGNORECASE):
        _add_cat(cats, "radio")
    if re.search(r"\bradio\s*drama|radio\s*play|imagination\s+theatre\b", hay, flags=re.IGNORECASE):
        _add_cat(cats, "radio")
        _add_cat(cats, "fiction/audio-drama")

    if any("audiobooks" in p for p in parts) or re.search(r"\baudiobook|audio\s*book\b", hay, flags=re.IGNORECASE):
        _add_cat(cats, "fiction/audiobook")
        _add_cat(cats, "fiction")

    if re.search(r"\baudio\s*drama|drama\b", hay, flags=re.IGNORECASE):
        _add_cat(cats, "fiction/audio-drama")
        _add_cat(cats, "fiction")

    if not cats:
        # Shouldn't happen given how we split, but keep it explicit.
        _add_cat(cats, "ttrpg")
    return cats


def _categories_other(feed: OpmlFeed) -> list[str]:
    cats: list[str] = []
    parts = [p.lower() for p in _opml_category_parts(feed)]
    hay = (feed.title + " " + feed.path).lower()

    # Some subscriptions are effectively "fiction/audiobook" but have no useful OPML category or title keywords.
    if "archive.org" in str(feed.url or "").lower():
        _add_cat(cats, "fiction")

    for p in parts:
        if p in ("feeds",):
            continue
        if "politics" in p:
            _add_cat(cats, "politics")
        elif "news" in p:
            _add_cat(cats, "news")
        elif "science" in p:
            _add_cat(cats, "science")
        elif "knowledge" in p:
            _add_cat(cats, "education")
        elif "audiobooks" in p:
            _add_cat(cats, "fiction")
            _add_cat(cats, "fiction/audiobook")
        elif "drama" in p:
            _add_cat(cats, "fiction")
            _add_cat(cats, "fiction/audio-drama")
        elif "arts" in p:
            _add_cat(cats, "culture")
        else:
            _add_cat(cats, p)

    for cat, rx in OTHER_HINTS:
        if rx.search(hay):
            _add_cat(cats, cat)

    if not cats:
        _add_cat(cats, "entertainment")
    return cats


def _categories_local(_feed: OpmlFeed) -> list[str]:
    return ["local"]


@dataclass(frozen=True)
class OpmlFeed:
    title: str
    url: str
    category: str
    path: str


def _is_local_url(url: str) -> bool:
    try:
        p = urlparse(str(url or ""))
    except Exception:
        return False

    if p.scheme not in ("http", "https"):
        return False

    host = p.hostname or ""
    if not host:
        return False

    if host == "localhost" or host.endswith(".local"):
        return True

    try:
        ip = ipaddress.ip_address(host)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local)
    except Exception:
        return False


def _read_opml_feeds(opml_path: Path) -> list[OpmlFeed]:
    import xml.etree.ElementTree as ET

    root = ET.parse(opml_path).getroot()
    body = root.find("body")
    if body is None:
        return []

    feeds: list[OpmlFeed] = []

    def walk(node: Any, parents: list[str]) -> None:
        title_raw = node.attrib.get("title") or node.attrib.get("text") or ""
        title = _norm_ws(_unescape_repeat(title_raw))
        url = _norm_ws(node.attrib.get("xmlUrl") or "")
        category = _norm_ws(_unescape_repeat(node.attrib.get("category") or ""))
        if url:
            feeds.append(OpmlFeed(title=title, url=url, category=category, path="/".join([p for p in parents if p])))
        for child in list(node):
            if str(getattr(child, "tag", "")).endswith("outline"):
                walk(child, parents + ([title] if title else []))

    for top in list(body):
        if str(getattr(top, "tag", "")).endswith("outline"):
            walk(top, [])

    # Dedup by URL (just in case; your file currently has none).
    seen: set[str] = set()
    out: list[OpmlFeed] = []
    for f in feeds:
        if f.url in seen:
            continue
        seen.add(f.url)
        out.append(f)
    return out


def _is_actualplay(feed: OpmlFeed) -> tuple[bool, str]:
    cat = (feed.category or "").lower()
    hay = (feed.title + " " + feed.path).lower()

    # Prefer OPML category when present.
    if "ttrpg" in cat or "/ttrpg" in cat:
        return True, "category:ttrpg"
    if "audiobooks" in cat or "drama" in cat:
        return True, "category:story"

    # Fallback heuristics for uncategorized feeds.
    if TTRPG_KW.search(hay):
        return True, "kw:ttrpg"
    if FICTION_KW.search(hay):
        return True, "kw:fiction"
    return False, ""


def _unique_slug(title: str, used: set[str]) -> str:
    base = slugify(title)
    slug = base
    i = 2
    while slug in used:
        slug = f"{base}-{i}"
        i += 1
    used.add(slug)
    return slug


def _make_config(feeds: list[OpmlFeed], *, include_notes: bool, mode: str) -> dict[str, Any]:
    used: set[str] = set()
    items: list[dict[str, Any]] = []
    for f in sorted(feeds, key=lambda x: x.title.lower()):
        if mode == "actualplays":
            categories = _categories_actualplays(f)
        elif mode == "other":
            categories = _categories_other(f)
        elif mode == "local":
            categories = _categories_local(f)
        else:
            categories = []

        row: dict[str, Any] = {
            "slug": _unique_slug(f.title, used),
            "url": f.url,
            "title_override": f.title,
        }
        if categories:
            row["categories"] = categories
        if include_notes and (f.category or f.path):
            bits = []
            if f.category:
                bits.append(f"opml category: {f.category}")
            if f.path:
                bits.append(f"opml path: {f.path}")
            if bits:
                row["notes"] = " · ".join(bits)
        items.append(row)

    return {
        "defaults": {
            "min_hours_between_checks": 12,
            "max_episodes_per_feed": 200,
            "request_timeout_seconds": 25,
            "user_agent": "actual-plays-static-podcast-index/1.0 (+https://github.com/)",
        },
        "feeds": items,
    }


def main() -> int:
    args = _parse_args()
    opml_path = (REPO_ROOT / args.opml).resolve() if not Path(args.opml).is_absolute() else Path(args.opml)
    feeds = _read_opml_feeds(opml_path)
    if not feeds:
        raise SystemExit(f"No feeds found in OPML: {opml_path}")

    local: list[OpmlFeed] = []
    ap: list[OpmlFeed] = []
    other: list[OpmlFeed] = []
    for f in feeds:
        if _is_local_url(f.url):
            local.append(f)
            continue
        is_ap, _reason = _is_actualplay(f)
        (ap if is_ap else other).append(f)

    out_ap = _make_config(ap, include_notes=False, mode="actualplays")
    out_other = _make_config(other, include_notes=False, mode="other")
    out_local = _make_config(local, include_notes=False, mode="local")

    (REPO_ROOT / args.out_actualplays).write_text(json.dumps(out_ap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (REPO_ROOT / args.out_other).write_text(json.dumps(out_other, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if local:
        (REPO_ROOT / args.out_local).write_text(
            json.dumps(out_local, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    print(f"[opml] {len(feeds)} feeds -> actualplays/story: {len(ap)} · other: {len(other)} · local: {len(local)}")
    print(f"[opml] wrote {args.out_actualplays}")
    print(f"[opml] wrote {args.out_other}")
    if local:
        print(f"[opml] wrote {args.out_local}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
