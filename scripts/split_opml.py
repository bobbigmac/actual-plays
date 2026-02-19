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


def _make_config(feeds: list[OpmlFeed], *, include_notes: bool) -> dict[str, Any]:
    used: set[str] = set()
    items: list[dict[str, Any]] = []
    for f in sorted(feeds, key=lambda x: x.title.lower()):
        categories: list[str] = []
        if f.category:
            for part in str(f.category).split(","):
                part = _norm_ws(_unescape_repeat(part)).strip()
                part = part.strip("/")
                if not part:
                    continue
                categories.append(part)
        # Dedup while preserving order.
        if categories:
            seen = set()
            categories = [c for c in categories if not (c in seen or seen.add(c))]

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

    out_ap = _make_config(ap, include_notes=False)
    out_other = _make_config(other, include_notes=False)
    out_local = _make_config(local, include_notes=False)

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
