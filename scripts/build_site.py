from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
from pathlib import Path
from typing import Any

from scripts.shared import REPO_ROOT, format_bytes, path_stats, path_stats_tree, read_feeds_config, sha1_hex, slugify, write_json
from scripts.shared import sanitize_speakers, sanitize_topics

from scripts.further_search import (
    further_search_cache_stats,
    further_search_state,
    get_external_episodes_for_speakers,
    run_further_search,
)

PLACEHOLDER_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
_PROFILE_DIRNAME = "feed-profiles"
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_RESERVED_ROOT_SLUGS = {
    "",
    "assets",
    "categories",
    "graph",
    "speakers",
    "sw.js",
    "manifest.webmanifest",
    "index.html",
    "site.json",
    "index.json",
}
_SPEAKER_IMAGE_EXT_PREFERENCE = {
    ".webp": 0,
    ".jpg": 1,
    ".jpeg": 2,
    ".png": 3,
    ".avif": 4,
    ".gif": 5,
}


def _safe_http_href(href: str) -> str:
    href = (href or "").strip()
    if not href:
        return ""
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return ""

def _norm_site_url(value: str | None) -> str:
    s = str(value or "").strip()
    if not s:
        return ""
    if not (s.startswith("http://") or s.startswith("https://")):
        return ""
    return s.rstrip("/") + "/"


def _abs_site_href(site_url: str, href: str) -> str:
    base = _norm_site_url(site_url)
    if not base:
        return ""
    try:
        return urllib.parse.urljoin(base, str(href or "").lstrip("/"))
    except Exception:
        return ""


def _page_href_for_out(out_path: Path, *, dist_dir: Path, base_path: str) -> str:
    rel = out_path.relative_to(dist_dir).as_posix()
    if rel == "index.html":
        return base_path
    if rel.endswith("/index.html"):
        return base_path + rel[: -len("index.html")]
    return base_path + rel


def _md_inline(text: str) -> str:
    """
    Minimal markdown inline formatting: links, code, bold, italics.
    Always escapes HTML; only http(s) links are allowed.
    """
    text = _esc(text or "")
    # code first to avoid reformatting inside it.
    text = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", text)
    # links: [label](url)
    def _link(m: re.Match) -> str:
        label = m.group(1)
        href = _safe_http_href(html.unescape(m.group(2)))
        if not href:
            return label
        return f'<a href="{_esc(href)}" rel="noopener">{label}</a>'

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", _link, text)
    # bold / italics
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    return text


def _render_min_md(text: str) -> str:
    """
    Very small markdown renderer for trusted local content.
    Supports headings (#), paragraphs, and unordered lists (- / *).
    """
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[list[str]] = []
    cur: list[str] = []
    for raw in lines:
        if raw.strip() == "":
            if cur:
                blocks.append(cur)
                cur = []
            continue
        cur.append(raw.rstrip("\n"))
    if cur:
        blocks.append(cur)

    out: list[str] = []
    for block in blocks:
        # heading
        if len(block) == 1 and block[0].lstrip().startswith("#"):
            s = block[0].lstrip()
            level = min(len(s) - len(s.lstrip("#")), 3)
            title = s[level:].strip()
            tag = {1: "h2", 2: "h3", 3: "h4"}[level]
            out.append(f"<{tag}>{_md_inline(title)}</{tag}>")
            continue
        # list
        if all(b.lstrip().startswith(("- ", "* ")) for b in block):
            items = []
            for b in block:
                item = b.lstrip()[2:].strip()
                items.append(f"<li>{_md_inline(item)}</li>")
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        # paragraph
        para = " ".join([b.strip() for b in block]).strip()
        out.append(f"<p>{_md_inline(para)}</p>")
    return "\n".join(out).strip()


def _parse_profile_md(text: str) -> tuple[dict[str, Any], str]:
    """
    Parses a profile markdown file with optional simple front matter:

    ---
    key: value
    score_production: 4
    ---
    Body markdown...
    """
    src = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not src.startswith("---\n"):
        return {}, src.strip()
    rest = src.split("\n", 1)[1]
    if "\n---\n" not in rest:
        return {}, src.strip()
    fm, body = rest.split("\n---\n", 1)
    meta: dict[str, Any] = {}
    for line in fm.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        key = k.strip()
        val = v.strip()
        if not key:
            continue
        if re.fullmatch(r"-?\d+", val):
            meta[key] = int(val)
        elif re.fullmatch(r"-?\d+\.\d+", val):
            meta[key] = float(val)
        else:
            meta[key] = val
    return meta, body.strip()

def _extract_first_h1(md: str) -> tuple[str, str]:
    """
    Extract a leading "# Title" from markdown and return (title, rest_md).
    If not found, returns ("", md).
    """
    src = (md or "").replace("\r\n", "\n").replace("\r", "\n").lstrip()
    if not src.startswith("#"):
        return "", (md or "").strip()
    lines = src.split("\n")
    first = lines[0].strip()
    if not first.startswith("# "):
        return "", (md or "").strip()
    title = first[2:].strip()
    rest = "\n".join(lines[1:]).strip()
    return title, rest


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build static HTML site from cached feed markdown.")
    p.add_argument(
        "--feeds",
        default="feeds.md",
        help="Path to feeds config Markdown (.md; includes top-level 'site', 'defaults', and 'feeds').",
    )
    p.add_argument("--cache", default="cache", help="Cache directory.")
    p.add_argument("--dist", default="dist", help="Output directory.")
    p.add_argument("--templates", default="site/templates", help="Templates directory.")
    p.add_argument("--assets", default="site/assets", help="Assets directory to copy into dist/assets.")
    p.add_argument("--base-path", default=None, help="Override base_path (useful for local dev).")
    return p.parse_args()


def _esc(text: str | None) -> str:
    return html.escape(text or "", quote=True)

def _safe_json_for_html(json_text: str) -> str:
    """
    Safely embed JSON in a <script type="application/json"> tag without
    breaking parsing or risking accidental HTML/script parsing.
    """
    s = str(json_text or "")
    return s.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")


def _norm_base_path(value: str | None) -> str:
    value = (value or "/").strip()
    if not value.startswith("/"):
        value = "/" + value
    if not value.endswith("/"):
        value += "/"
    return value


def _href(base_path: str, path: str) -> str:
    return base_path + path.lstrip("/")


def _speaker_images_by_slug(assets_dir: Path) -> dict[str, str]:
    """
    Return {speaker_slug: relative_path_under_assets} for available speaker images.
    """
    root = assets_dir / "images" / "speakers"
    if not root.exists():
        return {}

    chosen: dict[str, tuple[int, str, str]] = {}
    for p in sorted(root.iterdir()):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext not in _SPEAKER_IMAGE_EXT_PREFERENCE:
            continue
        slug = p.stem.strip().lower()
        if not slug:
            continue
        rel = (Path("images") / "speakers" / p.name).as_posix()
        pref = _SPEAKER_IMAGE_EXT_PREFERENCE[ext]
        prev = chosen.get(slug)
        if prev is None or pref < prev[0] or (pref == prev[0] and p.name < prev[1]):
            chosen[slug] = (pref, p.name, rel)
    return {slug: rel for slug, (_pref, _name, rel) in chosen.items()}


def _load_template(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _meta_extra_html(
    *,
    site_cfg: dict[str, Any],
    base_path: str,
    page_title: str,
    page_description: str,
    canonical_href: str,
    og_image: str | None = None,
    include_image: bool = True,
) -> str:
    site_url = _norm_site_url(site_cfg.get("url") or site_cfg.get("site_url") or site_cfg.get("canonical_url"))
    canonical = _abs_site_href(site_url, canonical_href) if site_url else ""

    site_name = str(site_cfg.get("title") or "").strip()
    title = _esc(page_title or site_name)
    desc = _esc(page_description or "")

    og_image_final = ""
    if include_image:
        # Page override first; then site config; then default promo.
        raw = (og_image or "").strip() or str(site_cfg.get("og_image") or site_cfg.get("ogImage") or "").strip()
        if raw:
            if _safe_http_href(raw):
                og_image_final = raw
            else:
                # Allow repo-local paths like "assets/promo.jpg" or already-absolute "/podcasts/assets/...".
                if raw.startswith("/"):
                    rel = raw
                else:
                    rel = _href(base_path, raw)
                og_image_final = _abs_site_href(site_url, rel) if site_url else rel
        if not og_image_final:
            promo = _href(base_path, "assets/promo.jpg")
            og_image_final = _abs_site_href(site_url, promo) if site_url else promo

    extra = [
        f'<link rel="canonical" href="{_esc(canonical)}" />' if canonical else "",
        f'<meta property="og:site_name" content="{_esc(site_name)}" />' if site_name else "",
        '<meta property="og:type" content="website" />',
        f'<meta property="og:title" content="{title}" />',
        f'<meta property="og:description" content="{desc}" />' if desc else "",
        f'<meta property="og:url" content="{_esc(canonical)}" />' if canonical else "",
        f'<meta property="og:image" content="{_esc(og_image_final)}" />' if og_image_final else "",
        '<meta name="twitter:card" content="summary_large_image" />'
        if og_image_final
        else '<meta name="twitter:card" content="summary" />',
        f'<meta name="twitter:title" content="{title}" />',
        f'<meta name="twitter:description" content="{desc}" />' if desc else "",
        f'<meta name="twitter:image" content="{_esc(og_image_final)}" />' if og_image_final else "",
    ]
    return "\n    ".join([x for x in extra if x])


def _render_template(template: str, ctx: dict[str, str]) -> str:
    out = template
    for key, value in ctx.items():
        out = out.replace("{{" + key + "}}", value)
    return out


def _load_feed_cache_json(md_path: Path) -> dict[str, Any] | None:
    if not md_path.exists():
        return None
    text = md_path.read_text(encoding="utf-8", errors="replace")
    marker = "<!-- FEED_JSON -->"
    if marker not in text:
        return None
    after = text.split(marker, 1)[1]
    fence = "```json"
    if fence not in after:
        return None
    body = after.split(fence, 1)[1]
    if "```" not in body:
        return None
    json_text = body.split("```", 1)[0]
    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        return None


def _snippet(text: str, *, limit: int = 320) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


def _plain_text(text: str) -> str:
    s = str(text or "")
    if not s:
        return ""
    s = html.unescape(s)
    s = _HTML_TAG_RE.sub(" ", s)
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _feed_fetch_warning_html(feed: dict[str, Any], *, compact: bool) -> str:
    fetch = feed.get("fetch")
    if not isinstance(fetch, dict):
        return ""
    status = str(fetch.get("status") or "").strip()
    if status not in ("warning", "error", "disabled"):
        return ""

    err = fetch.get("error")
    code = None
    msg = ""
    if isinstance(err, dict):
        code = err.get("status")
        msg = str(err.get("message") or "").strip()
    code_text = f"HTTP {int(code)}" if isinstance(code, int) and code else ""
    disabled_reason = str(fetch.get("disabled_reason") or "").strip()
    checked_at = str(fetch.get("checked_at") or "").strip()
    fetched_at = str(feed.get("fetched_at") or "").strip()

    if status == "disabled":
        headline = "Feed disabled"
    elif status == "error":
        headline = "Feed update failed"
    else:
        headline = "Feed parsed with warnings"
    bits: list[str] = []
    if code_text:
        bits.append(code_text)
    if msg:
        bits.append(msg)
    warn = fetch.get("warning")
    if isinstance(warn, dict):
        wmsg = str(warn.get("message") or "").strip()
        if wmsg:
            bits.append(wmsg)
    if disabled_reason and status == "disabled":
        bits.append(disabled_reason)
    detail = " — ".join([b for b in bits if b])

    stale = ""
    if fetched_at and checked_at and fetched_at != checked_at:
        stale = f"Using cached data from {fetched_at[:10]}."
    elif not fetched_at:
        stale = "No cached episodes yet."

    if compact:
        detail_text = f"{headline}: {detail}. {stale}".strip()
        return f'<div class="feed-warning muted">{_esc(detail_text)}</div>'

    detail_html = f"<div class=\"muted\">{_esc(detail)}</div>" if detail else ""
    stale_html = f"<div class=\"muted\">{_esc(stale)}</div>" if stale else ""
    return (
        f'<section class="card panel feed-warning-panel">'
        f"<div><strong>{_esc(headline)}</strong></div>"
        f"{detail_html}{stale_html}"
        f"</section>"
    )


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    s = str(value).strip()
    if not s:
        return None
    if not re.fullmatch(r"\d+", s):
        return None
    try:
        n = int(s)
        return n if n > 0 else None
    except Exception:
        return None


def _duration_seconds(value: Any) -> int | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if re.fullmatch(r"\d+", s):
        try:
            n = int(s)
            return n if n > 0 else None
        except Exception:
            return None
    if re.fullmatch(r"\d+:\d{2}", s):
        mm, ss = s.split(":", 1)
        try:
            m = int(mm)
            sec = int(ss)
            return m * 60 + sec
        except Exception:
            return None
    if re.fullmatch(r"\d+:\d{2}:\d{2}", s):
        hh, mm, ss = s.split(":", 2)
        try:
            h = int(hh)
            m = int(mm)
            sec = int(ss)
            return h * 3600 + m * 60 + sec
        except Exception:
            return None
    return None


def _fmt_time(seconds: int | None) -> str:
    if not seconds:
        return ""
    s = max(0, int(seconds))
    h = s // 3600
    m = (s % 3600) // 60
    ss = s % 60
    if h > 0:
        return f"{h}:{m:02d}:{ss:02d}"
    return f"{m}:{ss:02d}"


def _rss_pubdate(iso_value: str | None) -> str | None:
    s = str(iso_value or "").strip()
    if not s:
        return None

    # Preferred: ISO-ish timestamps we store in cache/index (e.g. 2026-02-18T12:34:56Z).
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            s = s + "T00:00:00+00:00"
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return format_datetime(dt.astimezone(timezone.utc))
    except Exception:
        pass

    # Fallback: some feeds provide RFC822/RFC2822-like dates.
    try:
        dt2 = parsedate_to_datetime(s)
        if dt2 is None:
            return None
        if dt2.tzinfo is None:
            dt2 = dt2.replace(tzinfo=timezone.utc)
        return format_datetime(dt2.astimezone(timezone.utc))
    except Exception:
        return None


def _fmt_hours(seconds: int | None) -> str:
    if not seconds:
        return ""
    s = max(0, int(seconds))
    h = s / 3600.0
    if h < 1:
        m = int(round(s / 60.0))
        return f"~{m}m" if m else ""
    hh = int(round(h))
    return f"~{hh}h"


def _fmt_size(bytes_value: int | None) -> str:
    if not bytes_value:
        return "?MB"
    return format_bytes(int(bytes_value))


def _fmt_avg_duration(seconds: int | None) -> str:
    if not seconds:
        return ""
    s = max(0, int(seconds))
    if s < 3600:
        m = int(round(s / 60.0))
        return f"~{m}m" if m else ""
    h = s // 3600
    m = (s % 3600) // 60
    if m:
        return f"~{h}h{m:02d}"
    return f"~{h}h"


def _feed_card_stats(feed: dict[str, Any]) -> dict[str, Any]:
    eps = feed.get("episodes") or []
    ep_count = len(eps) if isinstance(eps, list) else 0
    dur_total = 0
    dur_count = 0
    min_year = None
    max_year = None
    speaker_slugs: set[str] = set()
    if isinstance(eps, list):
        for ep in eps:
            if not isinstance(ep, dict):
                continue
            dt = str(ep.get("published_at") or "")
            if len(dt) >= 4 and dt[:4].isdigit():
                y = int(dt[:4])
                min_year = y if min_year is None else min(min_year, y)
                max_year = y if max_year is None else max(max_year, y)
            ds = _duration_seconds(ep.get("itunes_duration"))
            if ds:
                dur_total += int(ds)
                dur_count += 1
            for sp in ep.get("speakers") or []:
                s = slugify(str(sp))
                if s:
                    speaker_slugs.add(s)

    avg_seconds = int(round(dur_total / dur_count)) if dur_total and dur_count else None
    years_text = ""
    if min_year and max_year:
        years_text = f"{min_year}–{max_year}" if min_year != max_year else str(min_year)

    avg_seconds = avg_seconds if (avg_seconds and dur_count >= 3) else None
    return {
        "ep_count": ep_count,
        "speaker_count": len(speaker_slugs),
        "avg_seconds": avg_seconds,
        "avg_text": _fmt_avg_duration(avg_seconds) if avg_seconds else "",
        "years_text": years_text,
    }


def _expand_category(cat: str) -> list[str]:
    """
    Expand a category path like "ttrpgs/minor" into ["ttrpgs", "ttrpgs/minor"].
    For flat categories, returns [cat].
    """
    raw = str(cat or "").strip().strip("/")
    if not raw:
        return []
    parts = [p for p in raw.split("/") if p]
    out: list[str] = []
    for i in range(1, len(parts) + 1):
        out.append("/".join(parts[:i]))
    return out


def _unique_slug(base: str, used: set[str], *, salt: str) -> str:
    slug = base
    if slug not in used:
        used.add(slug)
        return slug
    slug = f"{base}-{sha1_hex(salt)[:6]}"
    if slug not in used:
        used.add(slug)
        return slug
    i = 2
    while True:
        candidate = f"{slug}-{i}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        i += 1


def _hue_from_slug(slug: str) -> int:
    total = 0
    for ch in slug:
        total = (total + ord(ch)) % 360
    return total


def _norm_name_list(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        v = value.strip()
        return [v] if v else []
    if isinstance(value, list):
        out = []
        for x in value:
            s = str(x or "").strip()
            if s:
                out.append(s)
        return out
    s = str(value).strip()
    return [s] if s else []


def _norm_categories(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for x in value:
            s = str(x or "").strip()
            if s:
                out.append(s)
        return out
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        parts = [p.strip().strip("/") for p in s.split(",")]
        return [p for p in parts if p]
    s = str(value).strip()
    return [s] if s else []

def _merge_always_speakers(*, detected: list[str] | None, always: list[str] | None, limit: int = 12) -> list[str]:
    base = sanitize_speakers(detected or [])
    always_clean = sanitize_speakers(always or [])
    if not always_clean:
        return base
    seen = {s.lower() for s in base}
    merged = list(base)
    for name in always_clean:
        k = name.lower()
        if k in seen:
            continue
        seen.add(k)
        merged.append(name)
        if len(merged) >= limit:
            break
    return merged


def _filter_excluded_speakers(*, speakers: list[str] | None, exclude: list[str] | None) -> list[str]:
    base = sanitize_speakers(speakers or [])
    # NOTE: exclusions are user-configured; do not run them through
    # sanitize_speakers() (it may drop valid names like "Joe Biden").
    ex = [str(x or "").strip() for x in (exclude or [])]
    ex = [x for x in ex if x]
    if not ex:
        return base
    ex_norm = {x.lower() for x in ex}
    if not ex_norm:
        return base
    out: list[str] = []
    for sp in base:
        s = str(sp).strip()
        if not s:
            continue
        s_norm = s.lower()
        if s_norm in ex_norm:
            continue
        if any(s_norm.startswith(x + " ") for x in ex_norm):
            continue
        out.append(s)
    return out


def _write_page(
    *,
    base_template: str,
    out_path: Path,
    dist_dir: Path,
    base_path: str,
    site_cfg: dict[str, Any],
    page_title: str,
    page_description: str,
    content_html: str,
    og_image: str | None = None,
    include_og_image: bool = True,
) -> None:
    footer_links = site_cfg.get("footer_links") or []
    footer_parts: list[str] = []
    for link in footer_links:
        label = _esc(str(link.get("label") or "link"))
        href = _esc(str(link.get("href") or "#"))
        footer_parts.append(f'<a href="{href}" rel="noopener">{label}</a>')
    footer_html = " · ".join(footer_parts) if footer_parts else ""

    canonical_href = _page_href_for_out(out_path, dist_dir=dist_dir, base_path=base_path)
    meta_extra = _meta_extra_html(
        site_cfg=site_cfg,
        base_path=base_path,
        page_title=page_title,
        page_description=page_description,
        canonical_href=canonical_href,
        og_image=og_image,
        include_image=include_og_image,
    )

    doc = _render_template(
        base_template,
        {
            "page_title": _esc(page_title),
            "page_description": _esc(page_description),
            "base_path": _esc(base_path),
            "base_path_json": json.dumps(base_path),
            "site_json": json.dumps(site_cfg, ensure_ascii=False),
            "site_title": _esc(site_cfg.get("title") or ""),
            "site_subtitle": _esc(site_cfg.get("subtitle") or ""),
            "meta_extra": meta_extra,
            "body_class": _esc(_page_body_class(out_path, dist_dir=dist_dir)),
            "content": content_html,
            "footer": footer_html,
        },
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(doc, encoding="utf-8")


def _page_body_class(out_path: Path, *, dist_dir: Path) -> str:
    try:
        rel = out_path.relative_to(dist_dir).as_posix()
    except Exception:
        rel = out_path.as_posix()
    if rel == "graph/index.html" or rel.startswith("graph/"):
        return "page-graph page-fullbleed"
    return ""


def _maybe_add_edit_feeds_link(*, site_cfg: dict[str, Any], feeds_path: str) -> None:
    """
    Inject an "Edit feeds" footer link next to the GitHub link (if present),
    pointing at the selected feeds file for this deployment.
    """
    feeds_path = str(feeds_path or "").strip()
    if not feeds_path:
        return

    footer_links = site_cfg.get("footer_links") or []
    if not isinstance(footer_links, list):
        return

    for l in footer_links:
        if isinstance(l, dict) and str(l.get("label") or "").strip().lower() in {"edit feeds", "edit config"}:
            return

    import os

    repo_url = None
    gh_repo = str(os.environ.get("GITHUB_REPOSITORY") or "").strip().strip("/")
    gh_server = str(os.environ.get("GITHUB_SERVER_URL") or "https://github.com").strip().rstrip("/")
    if gh_repo and "/" in gh_repo:
        repo_url = f"{gh_server}/{gh_repo}"

    github_index = None
    if repo_url is None:
        for i, link in enumerate(footer_links):
            if not isinstance(link, dict):
                continue
            href = str(link.get("href") or "").strip()
            if not href:
                continue
            p = urllib.parse.urlparse(href)
            if not (p.scheme and p.netloc):
                continue
            if "github.com" not in p.netloc.lower():
                continue
            parts = [x for x in p.path.split("/") if x]
            if len(parts) < 2:
                continue
            repo_url = f"{p.scheme}://{p.netloc}/{parts[0]}/{parts[1]}"
            break

    for i, link in enumerate(footer_links):
        if not isinstance(link, dict):
            continue
        if str(link.get("label") or "").strip().lower() == "github":
            github_index = i
            break

    if not repo_url:
        return

    branch = str(os.environ.get("AP_GITHUB_EDIT_BRANCH") or os.environ.get("GITHUB_REF_NAME") or "main").strip()
    branch = branch or "main"
    edit_href = f"{repo_url}/edit/{branch}/{urllib.parse.quote(feeds_path, safe='/')}"
    edit_link = {"label": "Edit feeds", "href": edit_href}

    if github_index is None:
        footer_links.append(edit_link)
    else:
        footer_links.insert(github_index + 1, edit_link)
    site_cfg["footer_links"] = footer_links


def _build_graph_data(
    *,
    feeds: list[dict[str, Any]],
    all_episodes_index: list[dict[str, Any]],
    base_path: str,
) -> dict[str, Any]:
    """
    Build a compact bipartite graph of podcasts <-> speakers.

    Nodes:
      - podcasts: id "p:<slug>"
      - speakers: id "s:<speaker_slug>"
    Edges:
      - appearance counts (episodes) as weight
      - flag whether the speaker is an owner of that podcast (own=1)
    """
    feed_by_slug: dict[str, dict[str, Any]] = {str(f.get("slug") or ""): f for f in feeds}
    owners_by_feed: dict[str, set[str]] = {}
    supplemental_by_feed: dict[str, bool] = {}

    for slug, feed in feed_by_slug.items():
        owners = sanitize_speakers(feed.get("owners") or [])
        owners_by_feed[slug] = {n.lower() for n in owners}
        supplemental_by_feed[slug] = bool(feed.get("supplemental"))

    # Count appearances per (podcast, speaker) and podcasts-per-speaker.
    edge_counts: dict[tuple[str, str], int] = defaultdict(int)
    speaker_pods: dict[str, set[str]] = defaultdict(set)
    speaker_totals: dict[str, int] = defaultdict(int)
    speaker_name_by_slug: dict[str, str] = {}

    for e in all_episodes_index:
        feed_slug = str(e.get("feed_slug") or "").strip()
        if not feed_slug:
            continue
        speakers = sanitize_speakers(e.get("speakers") or [])
        for sp in speakers:
            sp = str(sp or "").strip()
            if not sp:
                continue
            sp_slug = slugify(sp)
            if not sp_slug:
                continue
            if sp_slug not in speaker_name_by_slug:
                speaker_name_by_slug[sp_slug] = sp
            edge_counts[(feed_slug, sp_slug)] += 1
            speaker_pods[sp_slug].add(feed_slug)
            speaker_totals[sp_slug] += 1

    # Only include speakers that appear across >=2 podcasts (keep graph useful + small).
    multi_pod_speakers = [s for s, pods in speaker_pods.items() if len(pods) >= 2]
    multi_pod_speakers.sort(
        key=lambda s: (len(speaker_pods.get(s) or set()), speaker_totals.get(s) or 0),
        reverse=True,
    )

    MAX_SPEAKERS = 220
    TOP_EDGES_PER_SPEAKER = 8
    chosen_speakers = set(multi_pod_speakers[:MAX_SPEAKERS])

    # Build top edges per speaker to keep rendering/JSON lightweight.
    edges_by_speaker: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for (feed_slug, sp_slug), w in edge_counts.items():
        if sp_slug not in chosen_speakers:
            continue
        edges_by_speaker[sp_slug].append((feed_slug, int(w)))

    edges: list[list[Any]] = []
    connected_podcasts: set[str] = set()
    for sp_slug in chosen_speakers:
        items = edges_by_speaker.get(sp_slug) or []
        items.sort(key=lambda x: x[1], reverse=True)
        items = items[:TOP_EDGES_PER_SPEAKER]
        for feed_slug, w in items:
            feed = feed_by_slug.get(feed_slug)
            if not feed:
                continue
            own = 1 if (speaker_name_by_slug.get(sp_slug, "").lower() in owners_by_feed.get(feed_slug, set())) else 0
            edges.append([f"p:{feed_slug}", f"s:{sp_slug}", int(w), own])
            connected_podcasts.add(feed_slug)

    # Nodes: only connected podcasts + chosen speakers that have edges.
    node_by_id: dict[str, dict[str, Any]] = {}
    for feed_slug in sorted(connected_podcasts):
        feed = feed_by_slug.get(feed_slug) or {}
        title = str(feed.get("title") or feed_slug).strip() or feed_slug
        node_by_id[f"p:{feed_slug}"] = {
            "id": f"p:{feed_slug}",
            "t": "p",
            "l": title[:80],
            "h": _href(base_path, f"{feed_slug}/"),
            "sup": 1 if supplemental_by_feed.get(feed_slug) else 0,
        }

    connected_speakers: set[str] = set()
    for e in edges:
        sid = str(e[1])
        if sid.startswith("s:"):
            connected_speakers.add(sid[2:])

    for sp_slug in sorted(connected_speakers):
        name = speaker_name_by_slug.get(sp_slug) or sp_slug
        node_by_id[f"s:{sp_slug}"] = {
            "id": f"s:{sp_slug}",
            "t": "s",
            "l": str(name)[:80],
            "h": _href(base_path, f"{sp_slug}/"),
        }

    return {"nodes": list(node_by_id.values()), "edges": edges}


def main() -> int:
    args = _parse_args()

    try:
        cfg = read_feeds_config(REPO_ROOT / args.feeds)
    except Exception as e:
        print("[error] Failed to parse feeds config.", file=sys.stderr)
        print(f"Path: {REPO_ROOT / args.feeds}", file=sys.stderr)
        print(str(e), file=sys.stderr)
        print("", file=sys.stderr)
        print("Expected a Markdown file like:", file=sys.stderr)
        print("  # Site", file=sys.stderr)
        print("  - title: …", file=sys.stderr)
        print("  # Defaults", file=sys.stderr)
        print("  - min_hours_between_checks: 2", file=sys.stderr)
        print("  # Feeds", file=sys.stderr)
        print("  ## my-feed-slug", file=sys.stderr)
        print("  - url: https://example.com/rss", file=sys.stderr)
        return 2
    site_cfg = cfg.get("site") if isinstance(cfg, dict) else None
    if not isinstance(site_cfg, dict):
        site_cfg = {}
    site_cfg.setdefault("title", "Podcast Index")
    site_cfg.setdefault("subtitle", "A self-updating, static podcast browser")
    site_cfg.setdefault("description", "Built from RSS/Atom feeds. Episodes stream directly from the original hosts.")
    site_cfg.setdefault("base_path", "/")
    site_cfg.setdefault("footer_links", [])
    feeds_cfg = cfg if isinstance(cfg, dict) else {}

    _maybe_add_edit_feeds_link(site_cfg=site_cfg, feeds_path=args.feeds)

    cache_dir = REPO_ROOT / args.cache
    feeds_dir = cache_dir / "feeds"
    dist_dir = REPO_ROOT / args.dist
    templates_dir = REPO_ROOT / args.templates
    assets_dir = REPO_ROOT / args.assets

    base_override = args.base_path or __import__("os").environ.get("AP_BASE_PATH")
    base_path = _norm_base_path(base_override if base_override is not None else site_cfg.get("base_path"))
    site_url_norm = _norm_site_url(site_cfg.get("url") or site_cfg.get("site_url") or site_cfg.get("canonical_url"))

    base_template = _load_template(templates_dir / "base.html")

    # Optional per-feed profiles (markdown sidecars) keyed by feed slug.
    profiles_dir = REPO_ROOT / _PROFILE_DIRNAME
    feed_profile_by_slug: dict[str, dict[str, Any]] = {}
    if profiles_dir.exists():
        for p in sorted(profiles_dir.glob("*.md")):
            slug = p.stem
            meta, body = _parse_profile_md(p.read_text(encoding="utf-8", errors="replace"))
            feed_profile_by_slug[slug] = {
                "meta": meta,
                "body_md": body,
                "body_html": _render_min_md(body) if body.strip() else "",
            }

    # Optional per-speaker profiles keyed by speaker slug.
    speaker_profiles_dir = profiles_dir / "speakers"
    speaker_profile_by_slug: dict[str, dict[str, Any]] = {}
    if speaker_profiles_dir.exists():
        for p in sorted(speaker_profiles_dir.glob("*.md")):
            slug = p.stem
            meta, body = _parse_profile_md(p.read_text(encoding="utf-8", errors="replace"))
            title, rest = _extract_first_h1(body)
            speaker_profile_by_slug[slug] = {
                "meta": meta,
                "title": title.strip(),
                "body_md": rest,
                "body_html": _render_min_md(rest) if rest.strip() else "",
            }
    speaker_image_rel_by_slug = _speaker_images_by_slug(assets_dir)

    # Clean dist (but keep it within repo; callers control .gitignore).
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    (dist_dir / "assets").mkdir(parents=True, exist_ok=True)

    # Copy assets recursively so we can keep JS/CSS split into subfolders.
    for asset in assets_dir.rglob("*"):
        if not asset.is_file():
            continue
        rel = asset.relative_to(assets_dir)
        out = dist_dir / "assets" / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(asset, out)

    # PWA bits live at the site root so the service worker can control the whole base path.
    pwa_sw_src = (REPO_ROOT / "site" / "pwa" / "sw.js")
    if pwa_sw_src.exists():
        shutil.copy2(pwa_sw_src, dist_dir / "sw.js")

    manifest = {
        "name": site_cfg.get("title") or "Podcast Index",
        "short_name": site_cfg.get("title") or "Podcasts",
        "start_url": base_path,
        "scope": base_path,
        "display": "standalone",
        "background_color": "#0b0c0f",
        "theme_color": "#0b0c0f",
        "icons": [
            {"src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
    }
    (dist_dir / "manifest.webmanifest").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    feed_order: list[str] = []
    feed_tags: dict[str, dict[str, list[str]]] = {}
    feed_notes_by_slug: dict[str, str] = {}
    feed_title_override_by_slug: dict[str, str] = {}
    feed_url_by_slug: dict[str, str] = {}
    feed_supplemental_by_slug: dict[str, bool] = {}
    owner_slugs_by_feed: dict[str, set[str]] = {}
    site_exclude = [x for x in [str(v or "").strip() for v in _norm_name_list(site_cfg.get("exclude_speakers") or site_cfg.get("excludeSpeakers"))] if x]
    for f in feeds_cfg.get("feeds") or []:
        slug = str(f.get("slug") or "")
        if not slug:
            continue
        feed_order.append(slug)
        feed_url_by_slug[slug] = str(f.get("url") or "").strip()
        feed_supplemental_by_slug[slug] = bool(f.get("supplemental"))
        owners = sanitize_speakers(_norm_name_list(f.get("owners") or f.get("owner")))
        common_speakers = sanitize_speakers(_norm_name_list(f.get("common_speakers") or f.get("commonSpeakers")))
        exclude_speakers = [x for x in [str(v or "").strip() for v in _norm_name_list(f.get("exclude_speakers") or f.get("excludeSpeakers"))] if x]
        categories = _norm_categories(f.get("categories") or f.get("category"))
        feed_tags[slug] = {
            "owners": owners,
            "common_speakers": common_speakers,
            "exclude_speakers": [x for x in [str(v or "").strip() for v in (site_exclude + exclude_speakers)] if x],
            "categories": categories,
        }
        note = str(f.get("editors_note") or f.get("editor_note") or f.get("editorsNote") or "").strip()
        feed_notes_by_slug[slug] = note
        feed_title_override_by_slug[slug] = str(f.get("title_override") or f.get("titleOverride") or "").strip()
        owner_slugs_by_feed[slug] = {slugify(n) for n in owners}

    # We publish podcasts at the site root (relative to base_path), so reserve those names.
    for slug in feed_order:
        if slug in _RESERVED_ROOT_SLUGS:
            raise ValueError(
                f"Feed slug '{slug}' is reserved at the site root.\n"
                "Rename the feed slug in your feeds config.\n"
                f"Reserved: {', '.join(sorted(_RESERVED_ROOT_SLUGS))}"
            )

    if not feed_order:
        print("[warn] No feeds configured; generating an empty site.", file=sys.stderr)

    feeds: list[dict[str, Any]] = []
    for slug in feed_order:
        md_path = feeds_dir / f"{slug}.md"
        feed = _load_feed_cache_json(md_path)
        cfg_tags = feed_tags.get(slug) or {}
        cfg_owners = cfg_tags.get("owners") or []
        cfg_common = cfg_tags.get("common_speakers") or []
        cfg_exclude = cfg_tags.get("exclude_speakers") or []
        cfg_categories = cfg_tags.get("categories") or []
        cfg_note = str(feed_notes_by_slug.get(slug) or "").strip()
        cfg_title = str(feed_title_override_by_slug.get(slug) or "").strip()
        profile = feed_profile_by_slug.get(slug) or {}
        profile_meta = profile.get("meta") or {}
        profile_note = str(profile_meta.get("editors_note") or profile_meta.get("editor_note") or "").strip()
        note = profile_note or cfg_note
        scores = {
            k: v
            for k, v in profile_meta.items()
            if isinstance(k, str)
            and (k.startswith("score_") or k.startswith("rating_"))
            and isinstance(v, (int, float))
        }
        if not feed:
            feeds.append(
                {
                    "slug": slug,
                    "title": cfg_title or slug,
                    "description": "",
                    "source_url": str(feed_url_by_slug.get(slug) or "").strip(),
                    "episodes": [],
                    "missing_cache": True,
                    "supplemental": bool(feed_supplemental_by_slug.get(slug)),
                    "owners": sanitize_speakers(cfg_owners),
                    "common_speakers": sanitize_speakers(cfg_common),
                    "categories": _norm_categories(cfg_categories),
                    "editors_note": note,
                    "profile": profile,
                    "scores": scores,
                }
            )
            continue

        owners = sanitize_speakers(cfg_owners)
        common_speakers = sanitize_speakers(cfg_common)
        categories = _norm_categories(cfg_categories)
        feed["owners"] = owners
        feed["common_speakers"] = common_speakers
        feed["categories"] = categories
        feed["supplemental"] = bool(feed_supplemental_by_slug.get(slug))
        feed["editors_note"] = note
        feed["profile"] = profile
        feed["scores"] = scores
        owner_slugs_by_feed[slug] = {slugify(n) for n in owners}
        always = common_speakers + owners
        for ep in feed.get("episodes") or []:
            ep["speakers"] = _filter_excluded_speakers(
                speakers=_merge_always_speakers(detected=ep.get("speakers"), always=always, limit=12),
                exclude=cfg_exclude,
            )
            ep["topics"] = sanitize_topics(ep.get("topics"))
        feeds.append(feed)

    # Build speaker index.
    speaker_name_by_slug: dict[str, str] = {}
    speaker_eps_by_slug: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    all_episodes_index: list[dict[str, Any]] = []
    for feed in feeds:
        feed_slug = feed.get("slug") or ""
        feed_title = feed.get("title") or feed_slug
        feed_image_url = feed.get("image_url")
        for ep in feed.get("episodes") or []:
            speakers = ep.get("speakers") or []
            dur_seconds = _duration_seconds(ep.get("itunes_duration"))
            enclosure_bytes = _parse_int(ep.get("enclosure_length") or ep.get("enclosure_bytes"))
            enclosure_type = ep.get("enclosure_type")
            episode_key = ep.get("key")
            ep_entry = {
                "feed_slug": feed_slug,
                "feed_title": feed_title,
                "feed_image_url": feed_image_url,
                "episode_key": episode_key,
                "title": ep.get("title"),
                "published_at": ep.get("published_at"),
                "episode_image_url": ep.get("image_url"),
                "description": _snippet(_plain_text(ep.get("description") or ""), limit=320),
                "audio_url": ep.get("enclosure_url"),
                "link_url": ep.get("link"),
                "duration_seconds": dur_seconds,
                "enclosure_bytes": enclosure_bytes,
                "enclosure_type": enclosure_type,
                "speakers": speakers,
                "topics": ep.get("topics") or [],
            }
            all_episodes_index.append(ep_entry)
            if not episode_key:
                continue
            episode_id = f"{feed_slug}:{episode_key}"
            for sp in speakers:
                sp_name = str(sp)
                sp_slug = slugify(sp_name)
                existing = speaker_name_by_slug.get(sp_slug)
                if not existing:
                    speaker_name_by_slug[sp_slug] = sp_name
                else:
                    # Prefer the more "normal-looking" capitalization if we see variants.
                    if existing.isupper() and not sp_name.isupper():
                        speaker_name_by_slug[sp_slug] = sp_name
                speaker_eps_by_slug[sp_slug][episode_id] = ep_entry

    # Optional: further-search enrichment (API-based episode discovery for configured names).
    # `further_search` controls *querying*; cached results are merged whenever names are configured.
    further_search = bool(site_cfg.get("further_search"))
    further_search_names = _norm_name_list(site_cfg.get("further_search_names"))
    if further_search_names:
        # Always report enrichment state (querying may be off, cache merge still happens).
        st0 = further_search_state(cache_dir)
        stats0 = further_search_cache_stats(cache_dir)
        print(
            "[further-search] "
            f"query={'on' if further_search else 'off'} "
            f"names={len(further_search_names)} "
            f"batch_size={int(site_cfg.get('further_search_batch_size') or (feeds_cfg.get('defaults') or {}).get('further_search_batch_size') or 10)} "
            f"next_index={int(st0.get('next_index') or 0)} "
            f"cache={{speakers:{stats0['speakers']},eps:{stats0['episodes']}}}",
            file=sys.stderr,
        )
        local_audio_urls = {
            str(e.get("audio_url") or "").strip()
            for e in all_episodes_index
            if str(e.get("audio_url") or "").strip()
        }
        if further_search:
            run_further_search(
                cache_dir=cache_dir,
                names=further_search_names,
                enabled=True,
                batch_size=int(
                    site_cfg.get("further_search_batch_size")
                    or (feeds_cfg.get("defaults") or {}).get("further_search_batch_size")
                    or 10
                ),
                quiet=True,
            )
        st1 = further_search_state(cache_dir)
        stats1 = further_search_cache_stats(cache_dir)
        search_slugs = {slugify(n) for n in further_search_names if slugify(n)}
        external_by_speaker = get_external_episodes_for_speakers(
            cache_dir=cache_dir,
            speaker_slugs=search_slugs,
            local_audio_urls=local_audio_urls,
        )
        feed_title_by_slug = {str(f.get("slug") or ""): str(f.get("title") or "") for f in feeds if isinstance(f, dict)}
        merged = 0
        filtered_owned = 0
        for sp_slug, ext_eps in external_by_speaker.items():
            sp_name = next(
                (n for n in further_search_names if slugify(n) == sp_slug),
                sp_slug,
            )
            if sp_slug not in speaker_name_by_slug:
                speaker_name_by_slug[sp_slug] = sp_name

            # Exclude episodes from podcasts we *know* the speaker owns (from feeds config).
            owned_feed_slugs = [
                slug
                for slug, owner_slugs in (owner_slugs_by_feed or {}).items()
                if sp_slug in (owner_slugs or set())
            ]
            owned_urls = {
                str(feed_url_by_slug.get(slug) or "").strip().rstrip("/")
                for slug in owned_feed_slugs
                if str(feed_url_by_slug.get(slug) or "").strip()
            }
            owned_title_slugs = {
                slugify(feed_title_by_slug.get(slug) or "")
                for slug in owned_feed_slugs
                if (feed_title_by_slug.get(slug) or "").strip()
            }

            for ext_ep in ext_eps:
                src_rss = str(ext_ep.get("source_rss_url") or "").strip().rstrip("/")
                if src_rss and src_rss in owned_urls:
                    filtered_owned += 1
                    continue
                if slugify(str(ext_ep.get("feed_title") or "")) in owned_title_slugs:
                    filtered_owned += 1
                    continue
                feed_slug = str(ext_ep.get("feed_slug") or "external")
                ep_key = str(ext_ep.get("episode_key") or "")
                episode_id = f"{feed_slug}:{ep_key}"
                if episode_id not in speaker_eps_by_slug[sp_slug]:
                    speaker_eps_by_slug[sp_slug][episode_id] = ext_ep
                    merged += 1

        print(
            "[further-search] "
            f"cache_after={{speakers:{stats1['speakers']},eps:{stats1['episodes']}}} "
            f"next_index={int(st1.get('next_index') or 0)} "
            f"merged={merged} filtered_owned={filtered_owned}",
            file=sys.stderr,
        )

    # Speaker pages also live at the site root. Avoid collisions with podcast slugs and reserved paths.
    used_root = set(_RESERVED_ROOT_SLUGS) | set(feed_order)
    used = set(used_root)
    speaker_podcast_count_by_slug: dict[str, int] = {}
    for sp_slug, eps_by_id in speaker_eps_by_slug.items():
        pods: set[str] = set()
        for e in (eps_by_id or {}).values():
            feed_slug = str((e or {}).get("feed_slug") or "")
            if feed_slug:
                pods.add(feed_slug)
        speaker_podcast_count_by_slug[sp_slug] = len(pods)
    speaker_page_slug_by_slug: dict[str, str] = {}
    pinned_speakers = {slugify(n) for n in further_search_names if slugify(n)} if further_search_names else set()
    for sp_slug in sorted(speaker_name_by_slug.keys()):
        if (speaker_podcast_count_by_slug.get(sp_slug) or 0) <= 1 and sp_slug not in pinned_speakers:
            continue
        base = sp_slug
        if base in used:
            base = f"{sp_slug}-speaker"
        speaker_page_slug_by_slug[sp_slug] = _unique_slug(base, used, salt="speaker:" + sp_slug)

    # Sort index by date desc.
    all_episodes_index.sort(key=lambda e: e.get("published_at") or "", reverse=True)

    if feed_order and not all_episodes_index:
        print("[warn] No cached episodes found yet (run update script / wait for Action).", file=sys.stderr)

    # Emit search index JSON (lazy-loaded by the client).
    index_json = []
    for e in all_episodes_index:
        if not e.get("episode_key"):
            continue
        image_url = str((e.get("episode_image_url") or e.get("feed_image_url") or "")).strip()
        row = {
            "k": e["episode_key"],
            "t": e.get("title") or "",
            "d": (e.get("published_at") or "")[:10],
            "f": e.get("feed_slug") or "",
            "ft": e.get("feed_title") or "",
            "im": image_url,
            "s": e.get("speakers") or [],
            "x": e.get("topics") or [],
        }
        b = e.get("enclosure_bytes")
        du = e.get("duration_seconds")
        if isinstance(b, int) and b > 0:
            row["b"] = int(b)
        if isinstance(du, int) and du > 0:
            row["du"] = int(du)
        index_json.append(row)
    write_json(dist_dir / "index.json", index_json)
    write_json(dist_dir / "site.json", site_cfg)

    graph_data = _build_graph_data(feeds=feeds, all_episodes_index=all_episodes_index, base_path=base_path)
    graph_json = json.dumps(graph_data, ensure_ascii=False, separators=(",", ":"))

    # Categories (feeds can be in multiple categories).
    category_to_feeds: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for feed in feeds:
        feed_slug = str(feed.get("slug") or "")
        for raw in feed.get("categories") or []:
            for cat in _expand_category(str(raw)):
                category_to_feeds[cat][feed_slug] = feed

    cat_slug_by_name: dict[str, str] = {}
    if category_to_feeds:
        used = set()
        for cat in sorted(category_to_feeds.keys(), key=lambda x: x.lower()):
            cat_slug_by_name[cat] = _unique_slug(slugify(cat), used, salt=cat)

    # Home page.
    feed_cards = []
    supplemental_count = 0
    for feed in feeds:
        slug = str(feed.get("slug") or "")
        title = _esc(str(feed.get("title") or slug))
        desc = _esc(str(feed.get("description") or ""))
        note = _esc(_snippet(str(feed.get("editors_note") or ""), limit=140))
        warn_html = _feed_fetch_warning_html(feed, compact=True)
        stats = _feed_card_stats(feed)
        meta_bits: list[str] = []
        if stats["ep_count"]:
            meta_bits.append(f'{stats["ep_count"]} eps')
        if stats["speaker_count"]:
            meta_bits.append(f'{stats["speaker_count"]} speakers')
        if stats["avg_text"]:
            meta_bits.append(f'avg {stats["avg_text"]}')
        if stats["years_text"]:
            meta_bits.append(stats["years_text"])
        feed_meta_html = (
            '<div class="feed-stats">'
            + "".join([f'<span class="feed-stat">{_esc(b)}</span>' for b in meta_bits])
            + "</div>"
            if meta_bits
            else ""
        )
        image_url = str(feed.get("image_url") or "").strip()
        hue = _hue_from_slug(slug)
        initials = "".join([p[0].upper() for p in str(feed.get("title") or slug).split()[:2] if p])[:2] or "P"
        missing = feed.get("missing_cache")
        supplemental = bool(feed.get("supplemental"))
        if supplemental:
            supplemental_count += 1
        missing_note = (
            '<div class="muted">No cache yet (run update script / wait for Action).</div>' if missing else ""
        )
        note_html = f'<div class="muted feed-note">{note}</div>' if note else ""
        cover = (
            f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(image_url)}" data-fallback-text="{title}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
            if image_url
            else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
        )
        feed_cards.append(
            f"""
            <section class="card feed-card" data-feed-slug="{_esc(slug)}"
              data-supplemental="{'1' if supplemental else '0'}" {'hidden' if supplemental else ''}
              data-episode-count="{_esc(str(stats['ep_count'] or ''))}"
              data-speaker-count="{_esc(str(stats['speaker_count'] or ''))}"
              data-avg-seconds="{_esc(str(stats['avg_seconds'] or ''))}"
              data-years="{_esc(str(stats['years_text'] or ''))}">
              <a class="feed-cover" href="{_esc(_href(base_path, f"{slug}/"))}">
                {cover}
              </a>
	              <div class="feed-body">
	                <h2><a href="{_esc(_href(base_path, f"{slug}/"))}">{title}</a></h2>
                    {feed_meta_html}
	                <div class="muted feed-desc">{desc}</div>
	                {note_html}
                    {warn_html}
	                {missing_note}
	              </div>
	            </section>
	            """.strip()
        )

    podcasts_html = (
        "".join(feed_cards)
        if feed_cards
        else '<div class="muted">No podcasts configured in the feeds config.</div>'
    )

    recent_primary = [
        e
        for e in all_episodes_index
        if not bool((feed_supplemental_by_slug.get(e.get("feed_slug") or "")))
    ]
    recent_supp = [
        e for e in all_episodes_index if bool((feed_supplemental_by_slug.get(e.get("feed_slug") or "")))
    ]
    recent = sorted(
        recent_primary[:50] + recent_supp[:50],
        key=lambda e: str(e.get("published_at") or ""),
        reverse=True,
    )
    recent_items = []
    for e in recent:
        feed_slug = e.get("feed_slug") or ""
        key = e.get("episode_key") or ""
        episode_id = f"{feed_slug}:{key}"
        is_supp = bool(feed_supplemental_by_slug.get(str(feed_slug)))
        title = _esc(e.get("title") or "")
        date = _esc((e.get("published_at") or "")[:10])
        feed_title = _esc(e.get("feed_title") or feed_slug)
        audio = _esc(str(e.get("audio_url") or ""))
        link = _esc(str(e.get("link_url") or ""))
        dur_text = _esc(_fmt_time(e.get("duration_seconds")))
        size_text = _esc(_fmt_size(e.get("enclosure_bytes")))
        img_url = str((e.get("episode_image_url") or e.get("feed_image_url") or "")).strip()
        hue = _hue_from_slug(str(feed_slug))
        initials = "".join([p[0].upper() for p in str(e.get("feed_title") or feed_slug).split()[:2] if p])[:2] or "P"
        art = (
            f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(img_url)}" data-fallback-text="{feed_title}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
            if img_url
            else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
        )
        url = _href(base_path, f"{feed_slug}/?e={key}")
        meta_bits = [feed_title, date]
        if dur_text:
            meta_bits.append(dur_text)
        meta_bits.append(size_text)
        meta_line = " · ".join([m for m in meta_bits if m])
        recent_items.append(
            f"""
            <li class="episode-row" data-episode-id="{_esc(episode_id)}" data-supplemental="{'1' if is_supp else '0'}" {'hidden' if is_supp else ''}
              data-feed-slug="{_esc(feed_slug)}"
              data-episode-key="{_esc(key)}"
              data-episode-title="{title}"
              data-episode-date="{date}"
              data-feed-title="{feed_title}"
              data-episode-audio="{audio}"
              data-episode-link="{link}"
              data-episode-image="{_esc(img_url)}"
              data-episode-duration="{_esc(str(e.get("duration_seconds") or ""))}"
              data-episode-bytes="{_esc(str(e.get("enclosure_bytes") or ""))}">
              <div class="row-main">
                <div class="row-head">
                  <span class="row-art">{art}</span>
                  <div class="row-text">
                    <a href="{_esc(url)}">{title}</a>
                    <span class="muted">({meta_line})</span>
                  </div>
                </div>
              </div>
              <div class="row-actions">
                <button class="btn-primary btn-sm" type="button" data-action="play">Play</button>
                <button class="btn btn-sm queue-btn" type="button" data-action="queue">Queue</button>
                <details class="menu">
                  <summary class="btn btn-sm" aria-label="More actions">⋯</summary>
                  <div class="menu-panel card">
                    <button class="btn btn-sm" type="button" data-action="played">Mark played</button>
                    <button class="btn btn-sm" type="button" data-action="offline">Offline</button>
                  </div>
                </details>
              </div>
              <div class="mini-progress">
                <div class="mini-progress-bar" data-progress-bar></div>
              </div>
              <div class="mini-progress-text muted" data-progress-text></div>
            </li>
            """.strip()
        )

    home_intro_md = str(site_cfg.get("home_intro_md") or site_cfg.get("home_intro") or "").strip()
    home_intro_html = _render_min_md(home_intro_md) if home_intro_md else ""
    home_intro_block = f'<section class="card panel home-intro"><div class="md">{home_intro_html}</div></section>' if home_intro_html else ""

    views_bar = """
    <div class="card panel home-viewbar" data-home-viewbar>
      <button class="btn" type="button" data-home-view-btn="browse">
        Browse <span class="view-badge" data-home-view-badge="browse">0</span>
      </button>
      <button class="btn" type="button" data-home-view-btn="latest">
        Latest <span class="view-badge" data-home-view-badge="latest">0</span>
      </button>
      <button class="btn" type="button" data-home-view-btn="history">
        History <span class="view-badge" data-home-view-badge="history">0</span>
      </button>
      <button class="btn" type="button" data-home-view-btn="queue">
        Queue <span class="view-badge" data-home-view-badge="queue">0</span>
      </button>
    </div>
    """.strip()

    content = f"""
    <h1>{_esc(site_cfg.get("title") or "Podcast Index")}</h1>
    {home_intro_block}
    {views_bar}
    <div class="home-views">
      <section class="home-view" data-home-view="browse">
        <h2>Podcasts</h2>
        <div class="grid feed-grid">{podcasts_html}</div>
        {('<div class="browse-controls"><label class="toggle toggle-pill" data-toggle-label-for="browse-show-supplemental"><input id="browse-show-supplemental" type="checkbox" /><span class="toggle-pill-ui" aria-hidden="true"></span><span class="toggle-text" data-toggle-label>Show supplemental podcasts</span></label></div>' if supplemental_count else '')}
      </section>
      <section class="home-view" data-home-view="latest" hidden>
        <section class="card panel" id="home-latest">
          <div class="panel-head">
            <h2>Latest</h2>
            {('<label class="toggle toggle-pill latest-toggle" data-toggle-label-for="latest-show-supplemental"><input id="latest-show-supplemental" type="checkbox" /><span class="toggle-pill-ui" aria-hidden="true"></span><span class="toggle-text" data-toggle-label>Show supplemental episodes</span></label>' if supplemental_count else '')}
          </div>
          <ul class="list" data-latest-list>
            {"".join(recent_items) if recent_items else "<li class=\"muted\">No episodes yet.</li>"}
          </ul>
        </section>
      </section>
      <section class="home-view" data-home-view="history" hidden>
        <section class="card panel" id="home-history">
          <div class="panel-head">
            <h2>History</h2>
          </div>
          <div class="muted" data-empty>Nothing yet.</div>
          <ul class="list" data-history-list></ul>
        </section>
      </section>
      <section class="home-view" data-home-view="queue" hidden>
        <section class="card panel" id="home-queue">
          <div class="panel-head">
            <h2>Queue</h2>
          </div>
          <div class="muted" data-empty>Queue is empty.</div>
          <ul class="list" data-queue-list></ul>
        </section>
      </section>
    </div>
    """.strip()
    _write_page(
        base_template=base_template,
        out_path=dist_dir / "index.html",
        dist_dir=dist_dir,
        base_path=base_path,
        site_cfg=site_cfg,
        page_title=str(site_cfg.get("title") or "Podcast Index"),
        page_description=str(site_cfg.get("description") or ""),
        content_html=content,
    )

    # Category index + pages.
    rows = sorted(category_to_feeds.items(), key=lambda kv: (-len(kv[1]), kv[0].lower()))
    cat_items: list[str] = []
    for cat, feeds_by_slug in rows:
        url = _href(base_path, f"categories/{cat_slug_by_name[cat]}/")
        count = len(feeds_by_slug)
        cat_items.append(f'<li><a href="{_esc(url)}">{_esc(cat)}</a> <span class="muted">({count})</span></li>')

    content = f"""
    <h1>Categories</h1>
    <p class="muted">Podcasts can be in multiple categories (configured in the feeds config).</p>
    <ul class="list">
      {"".join(cat_items) if cat_items else "<li class=\"muted\">No categories configured.</li>"}
    </ul>
    """.strip()
    _write_page(
        base_template=base_template,
        out_path=dist_dir / "categories" / "index.html",
        dist_dir=dist_dir,
        base_path=base_path,
        site_cfg=site_cfg,
        page_title=f"Categories — {site_cfg.get('title') or ''}".strip(" —"),
        page_description="Podcast categories",
        content_html=content,
    )

    for cat, feeds_by_slug in rows:
        cards: list[str] = []
        for feed_slug in sorted(feeds_by_slug.keys()):
            feed = feeds_by_slug[feed_slug]
            slug = str(feed.get("slug") or "")
            title = _esc(str(feed.get("title") or slug))
            desc = _esc(str(feed.get("description") or ""))
            note = _esc(_snippet(str(feed.get("editors_note") or ""), limit=140))
            warn_html = _feed_fetch_warning_html(feed, compact=True)
            stats = _feed_card_stats(feed)
            meta_bits: list[str] = []
            if stats["ep_count"]:
                meta_bits.append(f'{stats["ep_count"]} eps')
            if stats["speaker_count"]:
                meta_bits.append(f'{stats["speaker_count"]} speakers')
            if stats["avg_text"]:
                meta_bits.append(f'avg {stats["avg_text"]}')
            if stats["years_text"]:
                meta_bits.append(stats["years_text"])
            feed_meta_html = (
                '<div class="feed-stats">'
                + "".join([f'<span class="feed-stat">{_esc(b)}</span>' for b in meta_bits])
                + "</div>"
                if meta_bits
                else ""
            )
            image_url = str(feed.get("image_url") or "").strip()
            hue = _hue_from_slug(slug)
            initials = "".join([p[0].upper() for p in str(feed.get("title") or slug).split()[:2] if p])[:2] or "P"
            cover = (
                f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(image_url)}" data-fallback-text="{title}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
                if image_url
                else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
            )
            note_html = f'<div class="muted feed-note">{note}</div>' if note else ""
            cards.append(
                f"""
                <section class="card feed-card" data-feed-slug="{_esc(slug)}"
                  data-episode-count="{_esc(str(stats['ep_count'] or ''))}"
                  data-speaker-count="{_esc(str(stats['speaker_count'] or ''))}"
                  data-avg-seconds="{_esc(str(stats['avg_seconds'] or ''))}"
                  data-years="{_esc(str(stats['years_text'] or ''))}">
                  <a class="feed-cover" href="{_esc(_href(base_path, f"{slug}/"))}">
                    {cover}
                  </a>
                  <div class="feed-body">
                    <h2><a href="{_esc(_href(base_path, f"{slug}/"))}">{title}</a></h2>
                    {feed_meta_html}
                    <div class="muted feed-desc">{desc}</div>
                    {note_html}
                    {warn_html}
                  </div>
                </section>
                """.strip()
            )

        content = f"""
        <h1>{_esc(cat)}</h1>
        <p class="muted">{len(feeds_by_slug)} podcasts</p>
        <div class="grid feed-grid">
          {"".join(cards) if cards else "<div class=\"muted\">No podcasts in this category.</div>"}
        </div>
        """.strip()
        _write_page(
            base_template=base_template,
            out_path=dist_dir / "categories" / cat_slug_by_name[cat] / "index.html",
            dist_dir=dist_dir,
            base_path=base_path,
            site_cfg=site_cfg,
            page_title=f"{cat} — {site_cfg.get('title') or ''}".strip(" —"),
            page_description=f"Podcasts in {cat}",
            content_html=content,
        )

    # Feed pages.
    for feed in feeds:
        slug = str(feed.get("slug") or "")
        title = str(feed.get("title") or slug)
        warn_html = _feed_fetch_warning_html(feed, compact=False)
        no_audio_panel = ""
        try:
            eps0 = feed.get("episodes") or []
            if isinstance(eps0, list) and eps0 and not any((e.get("enclosure_url") for e in eps0 if isinstance(e, dict))):
                no_audio_panel = (
                    '<section class="card panel feed-warning-panel">'
                    '<div><strong>No playable audio in this feed.</strong></div>'
                    '<div class="muted">This feed doesn’t provide audio enclosure URLs (e.g. some video feeds like YouTube). '
                    "Play will open the episode link instead.</div>"
                    "</section>"
                )
        except Exception:
            pass
        episodes_html = []
        for ep in feed.get("episodes") or []:
            key = str(ep.get("key") or "")
            episode_id = f"{slug}:{key}"
            ep_title = _esc(str(ep.get("title") or ""))
            date = _esc(str((ep.get("published_at") or "")[:10]))
            audio_raw = str(ep.get("enclosure_url") or "").strip()
            audio = _esc(audio_raw)
            link = _esc(str(ep.get("link") or ""))
            has_audio = bool(audio_raw)
            dur_seconds = _duration_seconds(ep.get("itunes_duration"))
            bytes_value = _parse_int(ep.get("enclosure_length") or ep.get("enclosure_bytes"))
            img_url = str((ep.get("image_url") or feed.get("image_url") or "")).strip()
            hue = _hue_from_slug(str(slug))
            initials = "".join([p[0].upper() for p in str(feed.get("title") or slug).split()[:2] if p])[:2] or "P"
            art = (
                f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(img_url)}" data-fallback-text="{_esc(str(feed.get("title") or slug))}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
                if img_url
                else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
            )
            desc_full = str(ep.get("description") or "")
            desc_snip = _snippet(desc_full, limit=360)
            has_more = bool(desc_full and len(desc_full) > len(desc_snip))
            dur = _esc(_fmt_time(dur_seconds))
            size = _esc(_fmt_size(bytes_value))
            speakers = ep.get("speakers") or []
            speaker_links = []
            for sp in speakers:
                sp_name = str(sp)
                sp_slug = slugify(sp_name)
                sp_page = speaker_page_slug_by_slug.get(sp_slug) or ""
                if sp_page:
                    speaker_links.append(
                        f'<a class="tag" href="{_esc(_href(base_path, f"{sp_page}/"))}">{_esc(sp_name)}</a>'
                    )
                else:
                    speaker_links.append(f'<span class="tag tag-muted">{_esc(sp_name)}</span>')
            speakers_html = ("".join(speaker_links)) if speaker_links else '<span class="muted">—</span>'
            ext_link_html = (
                f'<a class="ext" href="{link}" rel="noopener" target="_blank">Open episode</a>' if link else ""
            )
            dur_html = f'<span class="muted">· {dur}</span>' if dur else ""
            size_html = f'<span class="muted">· {size}</span>' if size else ""
            more_btn_html = (
                ' <button class="desc-toggle" type="button" data-desc-toggle aria-expanded="false">more…</button>'
                if has_more
                else ""
            )
            full_block_html = (
                f'<div class="desc-full" data-desc-full hidden>{_esc(desc_full)} '
                f'<button class="desc-toggle" type="button" data-desc-toggle aria-expanded="true">less</button></div>'
                if has_more
                else ""
            )
            primary_btn = (
                '<button class="btn-primary btn-sm" type="button" data-action="play">Play</button>'
                if has_audio
                else ('<button class="btn-primary btn-sm" type="button" data-action="open">Open</button>' if link else "")
            )
            queue_btn = (
                '<button class="btn btn-sm queue-btn" type="button" data-action="queue">Queue</button>' if has_audio else ""
            )
            offline_btn = '<button class="btn btn-sm" type="button" data-action="offline">Offline</button>' if has_audio else ""
            episodes_html.append(
                f"""
                <li class="episode" id="e-{_esc(key)}" data-episode-id="{_esc(episode_id)}"
                  data-episode-key="{_esc(key)}"
                  data-episode-title="{ep_title}"
                  data-episode-date="{date}"
                  data-episode-audio="{audio}"
                  data-episode-link="{link}"
                  data-episode-image="{_esc(img_url)}"
                  data-episode-duration="{_esc(str(dur_seconds or ''))}"
                  data-episode-bytes="{_esc(str(bytes_value or ''))}">
                  <div class="ep-actions">
                    <div class="ep-cover">{art}</div>
                    {primary_btn}
                    {queue_btn}
                    <details class="menu">
                      <summary class="btn btn-sm" aria-label="More actions">⋯</summary>
                      <div class="menu-panel card">
                        <button class="btn btn-sm" type="button" data-action="played">Mark played</button>
                        {offline_btn}
                        <div class="menu-sep"></div>
                        <button class="btn btn-sm" type="button" data-action="bulk-newer">Set newer as played</button>
                        <button class="btn btn-sm" type="button" data-action="bulk-older">Set older as played</button>
                      </div>
                    </details>
                  </div>
                  <div class="meta">
                    <div class="title">{ep_title}</div>
                    <div class="sub muted">{date} {dur_html} {size_html} {ext_link_html}</div>
                    <div class="tags">{speakers_html}</div>
                    <div class="desc-wrap" data-desc-wrap>
                      <div class="desc-snippet" data-desc-snippet>
                        {_esc(desc_snip)}{more_btn_html}
                      </div>
                      {full_block_html}
                    </div>
                    <div class="mini-progress">
                      <div class="mini-progress-bar" data-progress-bar></div>
                    </div>
                    <div class="mini-progress-text muted" data-progress-text></div>
                  </div>
                </li>
                """.strip()
            )

        feed_link = feed.get("link") or feed.get("source_url") or ""
        feed_desc = feed.get("description") or ""
        categories = feed.get("categories") or []
        note = str(feed.get("editors_note") or "").strip()
        profile = feed.get("profile") or {}
        profile_body_html = str(profile.get("body_html") or "").strip()
        scores = feed.get("scores") or {}

        scores_html = ""
        if isinstance(scores, dict) and scores:
            items: list[str] = []
            for k in sorted(scores.keys()):
                v = scores.get(k)
                if not isinstance(k, str) or not isinstance(v, (int, float)):
                    continue
                name = k
                if name.startswith("score_"):
                    name = name[len("score_") :]
                if name.startswith("rating_"):
                    name = name[len("rating_") :]
                label = _esc(name.replace("_", " ").strip().title() or "Score")
                val = float(v)
                val_text = f"{int(val)}/5" if float(int(val)) == val and 0 <= val <= 5 else f"{val:g}"
                items.append(f'<div class="score"><div class="k">{label}</div><div class="v">{_esc(val_text)}</div></div>')
            if items:
                scores_html = f'<div class="scores" aria-label="Ratings">{"".join(items)}</div>'

        profile_panel = ""
        if note or profile_body_html or scores_html:
            note_html = f'<p class="muted"><strong>Editor’s note:</strong> {_esc(note)}</p>' if note else ""
            body_html = f'<div class="md">{profile_body_html}</div>' if profile_body_html else ""
            profile_panel = f'<section class="card panel feed-profile">{note_html}{scores_html}{body_html}</section>'
        cat_links: list[str] = []
        for raw in categories:
            cat = str(raw or "").strip().strip("/")
            if not cat:
                continue
            cat_slug = cat_slug_by_name.get(cat) or slugify(cat)
            cat_links.append(f'<a class="tag" href="{_esc(_href(base_path, f"categories/{cat_slug}/"))}">{_esc(cat)}</a>')
        cats_html = f'<div class="tags">{"".join(cat_links)}</div>' if cat_links else ""

        rss_url = _safe_http_href(str(feed.get("source_url") or ""))
        rss_q = urllib.parse.quote(rss_url, safe="") if rss_url else ""
        title_q = urllib.parse.quote(str(title or ""), safe="")
        subscribe_panel = ""
        if rss_url:
            rss_icon = _href(base_path, "assets/rss.svg")
            subscribe_panel = f"""
            <section class="card panel subscribe-panel">
              <div class="panel-head">
                <h2 class="panel-title"><img class="rss-icon" src="{_esc(rss_icon)}" alt="" aria-hidden="true" /> RSS</h2>
                <a class="btn btn-sm" href="{_esc(rss_url)}" rel="noopener" target="_blank">RSS</a>
              </div>
              <div class="subscribe-row">
                <input class="rss-input" type="text" value="{_esc(rss_url)}" readonly />
                <button class="btn btn-sm" type="button" data-copy-text="{_esc(rss_url)}">Copy</button>
                <button class="btn btn-sm" type="button" data-share-url="{_esc(rss_url)}" data-share-title="{_esc(title)}">Share</button>
              </div>
              <div class="subscribe-actions">
                <a class="btn btn-sm" href="{_esc('https://overcast.fm/add?url=' + rss_q)}" rel="noopener" target="_blank">Overcast</a>
                <a class="btn btn-sm" href="{_esc('https://pocketcasts.com/submit/?url=' + rss_q)}" rel="noopener" target="_blank">Pocket Casts</a>
                <a class="btn btn-sm" href="{_esc('https://gpodder.net/subscribe?url=' + rss_q)}" rel="noopener" target="_blank">gPodder</a>
                <a class="btn btn-sm" href="{_esc('https://podcasts.apple.com/search?term=' + title_q)}" rel="noopener" target="_blank">Apple Podcasts</a>
                <a class="btn btn-sm" data-android-intent hidden data-intent-url="{_esc(rss_url)}" rel="noopener">Open in app</a>
                <a class="btn btn-sm" data-ios-feed hidden data-feed-url="{_esc(rss_url)}" rel="noopener">Open in app</a>
              </div>
            </section>
            """.strip()
        content = f"""
        <h1>{_esc(title)}</h1>
        <p class="muted">{_esc(feed_desc)}</p>
        {warn_html}
        {no_audio_panel}
        {subscribe_panel}
        {profile_panel}
        {cats_html}
        <p><a href="{_esc(feed_link)}" rel="noopener">Official link</a></p>
        <ul class="episodes">
          {"".join(episodes_html) if episodes_html else '<li class="muted">No cached episodes yet.</li>'}
        </ul>
        """.strip()
        _write_page(
            base_template=base_template,
            out_path=dist_dir / slug / "index.html",
            dist_dir=dist_dir,
            base_path=base_path,
            site_cfg=site_cfg,
            page_title=f"{title} — {site_cfg.get('title') or ''}".strip(" —"),
            page_description=feed_desc,
            content_html=content,
            og_image=str(feed.get("image_url") or "").strip() or None,
        )

    # Speaker index + pages.
    speaker_rows = []
    for sp_slug, eps_by_id in speaker_eps_by_slug.items():
        speaker = speaker_name_by_slug.get(sp_slug) or sp_slug
        eps = list(eps_by_id.values())
        total = len(eps)
        guest = 0
        pods_total: set[str] = set()
        pods_guest: set[str] = set()
        for e in eps:
            feed_slug = str(e.get("feed_slug") or "")
            if feed_slug:
                pods_total.add(feed_slug)
            owners = owner_slugs_by_feed.get(feed_slug) or set()
            if sp_slug in owners:
                continue
            guest += 1
            if feed_slug:
                pods_guest.add(feed_slug)
        speaker_rows.append((sp_slug, speaker, guest, total, len(pods_guest), len(pods_total)))
    # Sort by podcast spread first, then total episode appearances.
    speaker_rows.sort(key=lambda r: (-r[5], -r[3], -r[4], -r[2], r[1].lower()))

    # Ensure pinned/whitelisted speakers always show up (and have pages).
    pinned_slugs = {slugify(n) for n in _norm_name_list(site_cfg.get("further_search_names")) if slugify(n)}
    speaker_rows_by_slug = {r[0]: r for r in speaker_rows}
    for sp_slug in sorted(pinned_slugs):
        if sp_slug not in speaker_rows_by_slug:
            speaker_rows.append((sp_slug, speaker_name_by_slug.get(sp_slug) or sp_slug, 0, 0, 0, 0))
        if sp_slug not in speaker_name_by_slug:
            speaker_name_by_slug[sp_slug] = sp_slug

    speaker_rows.sort(key=lambda r: (-r[5], -r[3], -r[4], -r[2], r[1].lower()))
    speaker_rows_top = list(speaker_rows[:500])
    top_slugs = {r[0] for r in speaker_rows_top}
    for sp_slug in pinned_slugs:
        if sp_slug in top_slugs:
            continue
        # Find row for pinned slug and append.
        for r in speaker_rows:
            if r[0] == sp_slug:
                speaker_rows_top.append(r)
                break
    has_owner_data = any(bool(s) for s in owner_slugs_by_feed.values())
    show_own_toggle = has_owner_data
    counts_note = (
        "Owner metadata is unavailable for this feed set, so all counts are totals."
        if not show_own_toggle
        else "Guest counts exclude episodes from podcasts the speaker owns (as configured in the feeds config)."
    )

    speaker_list_items = []
    for sp_slug, speaker, guest_count, total_count, guest_pods, total_pods in speaker_rows_top:
        sp_page = speaker_page_slug_by_slug.get(sp_slug) or ""
        speaker_img_rel = speaker_image_rel_by_slug.get(sp_slug) or ""
        speaker_img_html = ""
        if speaker_img_rel:
            speaker_img_url = _href(base_path, f"assets/{speaker_img_rel}")
            speaker_img_html = (
                f'  <div class="speaker-card-image speaker-image-frame" aria-hidden="true">'
                f'    <img src="{_esc(speaker_img_url)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;display:block;object-fit:cover;object-position:center center;" />'
                f"  </div>"
            )
        has_page = bool(sp_page)
        url = _href(base_path, f"{sp_page}/") if sp_page else ""
        stats_total_html = ""
        guest_kind = "Guest" if show_own_toggle else "All"
        same_counts = guest_count == total_count and guest_pods == total_pods
        if show_own_toggle and not same_counts:
            stats_total_html = (
                f'    <div class="speaker-stats-row" data-speaker-stats="total" data-primary="0">'
                f'      <div class="speaker-stats-kind">Total</div>'
                f'      <div class="speaker-stats-metrics">'
                f'        <div class="speaker-metric"><span class="speaker-metric-num" data-speaker-count-total>{total_count}</span><span class="speaker-metric-unit">eps</span></div>'
                f'        <div class="speaker-metric"><span class="speaker-metric-num" data-speaker-pods-total>{total_pods}</span><span class="speaker-metric-unit">pods</span></div>'
                f"      </div>"
                f"    </div>"
            )
        if show_own_toggle and same_counts:
            guest_kind = "All"

        tag = "a" if has_page else "div"
        card_class = "card speaker-card speaker-card-link" if has_page else "card speaker-card speaker-card-static"
        href_attr = f' href="{_esc(url)}"' if has_page else ""
        speaker_list_items.append(
            f'<{tag} class="{card_class}" {href_attr} data-speaker-row '
            f'data-count-guest="{guest_count}" data-count-total="{total_count}" '
            f'data-pods-guest="{guest_pods}" data-pods-total="{total_pods}" data-name="{_esc(speaker)}">'
            f'  <div class="speaker-card-head">'
            f"{speaker_img_html}"
            f'    <div class="speaker-card-main">'
            f'      <div class="speaker-card-name">{_esc(speaker)}</div>'
            f'      <div class="speaker-card-stats" data-speaker-stats-wrap>'
            f'        <div class="speaker-stats-row" data-speaker-stats="guest" data-primary="1">'
            f'          <div class="speaker-stats-kind">{guest_kind}</div>'
            f'          <div class="speaker-stats-metrics">'
            f'            <div class="speaker-metric"><span class="speaker-metric-num" data-speaker-count-guest>{guest_count}</span><span class="speaker-metric-unit">eps</span></div>'
            f'            <div class="speaker-metric"><span class="speaker-metric-num" data-speaker-pods-guest>{guest_pods}</span><span class="speaker-metric-unit">pods</span></div>'
            f"          </div>"
            f"        </div>"
            f"{stats_total_html}"
            f"      </div>"
            f"    </div>"
            f"  </div>"
            f'</{tag}>'
        )

    content = f"""
    <div class="speakers-top">
      <div class="speakers-head">
        <h1>Speakers</h1>
        <p class="muted">Heuristic extraction from titles/descriptions. Expect some noise. Speaker pages/RSS are generated for speakers that appear on 2+ podcasts (or are whitelisted via <code>further_search_names</code>).</p>
        <div class="speakers-filter">
          <input id="speakers-filter" class="speaker-filter-input" type="search" placeholder="Filter speakers…" autocomplete="off" />
          <div id="speakers-filter-status" class="muted"></div>
        </div>
      </div>
    </div>
    <div class="grid speaker-grid" data-speaker-grid>
      {"".join(speaker_list_items) if speaker_list_items else "<div class=\"muted\">No speakers yet.</div>"}
    </div>
    """.strip()
    _write_page(
        base_template=base_template,
        out_path=dist_dir / "speakers" / "index.html",
        dist_dir=dist_dir,
        base_path=base_path,
        site_cfg=site_cfg,
        page_title=f"Speakers — {site_cfg.get('title') or ''}".strip(" —"),
        page_description="Speaker index",
        content_html=content,
    )

    for sp_slug, speaker, guest_count, total_count, guest_pods, total_pods in speaker_rows_top:
        if sp_slug not in speaker_page_slug_by_slug:
            continue
        eps = list((speaker_eps_by_slug.get(sp_slug) or {}).values())
        guest_eps = []
        for e in eps:
            feed_slug = str(e.get("feed_slug") or "")
            if sp_slug in (owner_slugs_by_feed.get(feed_slug) or set()):
                continue
            guest_eps.append(e)
        guest_eps.sort(key=lambda e: e.get("published_at") or "", reverse=True)
        guest_eps = guest_eps[:50]
        has_guest_feed = len(guest_eps) > 1

        # Group episodes by source podcast; show the biggest groups first.
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for e in eps[:500]:
            feed_slug = str(e.get("feed_slug") or "")
            feed_title = str(e.get("feed_title") or feed_slug)
            grouped[(feed_slug, feed_title)].append(e)

        group_rows = sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0][1].lower(), kv[0][0]))
        groups_html: list[str] = []
        for (feed_slug, feed_title_raw), group_eps in group_rows:
            is_own = sp_slug in (owner_slugs_by_feed.get(feed_slug) or set())
            feed_title = _esc(feed_title_raw or feed_slug)
            group_eps.sort(key=lambda e: e.get("published_at") or "", reverse=True)
            items: list[str] = []
            for e in group_eps:
                key = str(e.get("episode_key") or "")
                episode_id = f"{feed_slug}:{key}"
                title = _esc(str(e.get("title") or ""))
                date = _esc(str((e.get("published_at") or "")[:10]))
                audio = _esc(str(e.get("audio_url") or ""))
                link = _esc(str(e.get("link_url") or ""))
                dur_text = _esc(_fmt_time(e.get("duration_seconds")))
                size_text = _esc(_fmt_size(e.get("enclosure_bytes")))
                img_url = str((e.get("episode_image_url") or e.get("feed_image_url") or "")).strip()
                hue = _hue_from_slug(str(feed_slug))
                initials = "".join([p[0].upper() for p in str(feed_title_raw or feed_slug).split()[:2] if p])[:2] or "P"
                art = (
                    f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(img_url)}" data-fallback-text="{_esc(str(e.get("feed_title") or feed_slug))}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
                    if img_url
                    else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
                )
                # External episodes don't have local podcast pages; link out instead.
                if str(feed_slug).startswith("external:"):
                    url = (
                        _safe_http_href(str(e.get("link_url") or ""))
                        or _safe_http_href(str(e.get("audio_url") or ""))
                        or ""
                    )
                else:
                    url = _href(base_path, f"{feed_slug}/?e={key}")
                meta_bits = [date]
                if dur_text:
                    meta_bits.append(dur_text)
                meta_bits.append(size_text)
                meta_line = " · ".join([m for m in meta_bits if m])
                items.append(
                    f"""
                    <li class="episode-row" data-episode-id="{_esc(episode_id)}"
                      data-feed-slug="{_esc(feed_slug)}"
                      data-episode-key="{_esc(key)}"
                      data-episode-title="{title}"
                      data-episode-date="{date}"
                      data-feed-title="{feed_title}"
                      data-episode-audio="{audio}"
                      data-episode-link="{link}"
                      data-episode-image="{_esc(img_url)}"
                      data-episode-duration="{_esc(str(e.get("duration_seconds") or ''))}"
                      data-episode-bytes="{_esc(str(e.get("enclosure_bytes") or ''))}">
                      <div class="row-main">
                        <div class="row-head">
                          <span class="row-art">{art}</span>
                          <div class="row-text">
                            <a href="{_esc(url)}">{title}</a>
                            <span class="muted">({meta_line})</span>
                          </div>
                        </div>
                      </div>
                      <div class="row-actions">
                        <button class="btn-primary btn-sm" type="button" data-action="play">Play</button>
                        <button class="btn btn-sm queue-btn" type="button" data-action="queue">Queue</button>
                        <details class="menu">
                          <summary class="btn btn-sm" aria-label="More actions">⋯</summary>
                          <div class="menu-panel card">
                            <button class="btn btn-sm" type="button" data-action="played">Mark played</button>
                            <button class="btn btn-sm" type="button" data-action="offline">Offline</button>
                          </div>
                        </details>
                      </div>
                      <div class="mini-progress">
                        <div class="mini-progress-bar" data-progress-bar></div>
                      </div>
                      <div class="mini-progress-text muted" data-progress-text></div>
                    </li>
                    """.strip()
                )

            podcast_url = _href(base_path, f"{feed_slug}/") if str(feed_slug) in set(feed_order) else ""
            groups_html.append(
                f"""
                <details class="speaker-group card" open data-own="{'1' if is_own else '0'}" {'hidden' if is_own else ''}>
                  <summary>
                    <span class="speaker-group-title">{feed_title}</span>
                    <span class="muted">({len(group_eps)})</span>
                  </summary>
                  <div class="muted speaker-group-meta">
                    {('<a href="' + _esc(podcast_url) + '">Open podcast</a>') if podcast_url else '<span class="muted">External podcast</span>'}
                  </div>
                  <ul class="list">
                    {"".join(items)}
                  </ul>
                </details>
                """.strip()
            )
        sp_profile = speaker_profile_by_slug.get(sp_slug) or {}
        sp_title = str(sp_profile.get("title") or "").strip()
        sp_body_html = str(sp_profile.get("body_html") or "").strip()
        speaker_h1 = sp_title or speaker
        speaker_img_rel = speaker_image_rel_by_slug.get(sp_slug) or ""
        speaker_img_url = _href(base_path, f"assets/{speaker_img_rel}") if speaker_img_rel else ""
        speaker_image_block = ""
        if speaker_img_rel:
            speaker_image_block = (
                f'<img src="{_esc(speaker_img_url)}" alt="{_esc(speaker_h1)}" decoding="async" />'
            )
        speaker_intro_html = (
            f'<div class="md">{sp_body_html}</div>'
            if sp_body_html
            else '<p class="muted">Profile notes not added yet.</p>'
        )

        speaker_feed_panel = ""
        sp_page = speaker_page_slug_by_slug.get(sp_slug) or sp_slug
        if has_guest_feed:
            rss_path = _href(base_path, f"{sp_page}/feed.xml")
            rss_icon = _href(base_path, "assets/rss.svg")
            rss_abs = _abs_site_href(site_url_norm, rss_path) if site_url_norm else ""
            rss_for_actions = rss_abs or rss_path
            rss_q = urllib.parse.quote(rss_abs, safe="") if rss_abs else ""
            title_q = urllib.parse.quote(str(speaker_h1 or ""), safe="")
            app_links = ""
            if rss_abs:
                app_links = (
                    f'<a class="btn btn-sm" href="{_esc("https://overcast.fm/add?url=" + rss_q)}" rel="noopener" target="_blank">Overcast</a>'
                    f'<a class="btn btn-sm" href="{_esc("https://pocketcasts.com/submit/?url=" + rss_q)}" rel="noopener" target="_blank">Pocket Casts</a>'
                    f'<a class="btn btn-sm" href="{_esc("https://gpodder.net/subscribe?url=" + rss_q)}" rel="noopener" target="_blank">gPodder</a>'
                    f'<a class="btn btn-sm" href="{_esc("https://podcasts.apple.com/search?term=" + title_q)}" rel="noopener" target="_blank">Apple Podcasts</a>'
                )
            speaker_feed_panel = f"""
            <section class="card panel subscribe-panel">
              <div class="panel-head">
                <h2 class="panel-title"><img class="rss-icon" src="{_esc(rss_icon)}" alt="" aria-hidden="true" /> RSS</h2>
                <a class="btn btn-sm" href="{_esc(rss_path)}">Feed</a>
              </div>
              <div class="subscribe-row">
                <input class="rss-input" type="text" value="{_esc(rss_for_actions)}" readonly />
                <button class="btn btn-sm" type="button" data-copy-text="{_esc(rss_for_actions)}">Copy</button>
                <button class="btn btn-sm" type="button" data-share-url="{_esc(rss_for_actions)}" data-share-title="{_esc(speaker_h1)}">Share</button>
              </div>
              <div class="subscribe-actions">
                {app_links}
                <a class="btn btn-sm" data-android-intent hidden data-intent-url="{_esc(rss_for_actions)}" rel="noopener">Open in app</a>
                <a class="btn btn-sm" data-ios-feed hidden data-feed-url="{_esc(rss_for_actions)}" rel="noopener">Open in app</a>
              </div>
              <div class="muted" style="margin-top:8px">Most recent guest appearances (excluding own podcasts) — up to 50 items.</div>
            </section>
            """.strip()

        content = f"""
        <section class="card panel speaker-hero">
          <div class="speaker-hero-row">
            <div class="speaker-hero-text">
              <h1>{_esc(speaker_h1)}</h1>
              {speaker_intro_html}
            </div>
            <div class="speaker-hero-media">{speaker_image_block}</div>
          </div>
        </section>
        <div class="speaker-top-panels">
          <section class="card panel speaker-controls">
            <div class="panel-head">
              <h2>Appearances</h2>
            </div>
            <div class="speaker-counts" style="margin-top:8px">
              <div class="speaker-stats-row" data-speaker-stats="guest" data-primary="1">
                <div class="speaker-stats-kind">{'Guest' if show_own_toggle else 'All'}</div>
                <div class="speaker-stats-metrics">
                  <div class="speaker-metric"><span class="speaker-metric-num">{guest_count}</span><span class="speaker-metric-unit">eps</span></div>
                  <div class="speaker-metric"><span class="speaker-metric-num">{guest_pods}</span><span class="speaker-metric-unit">pods</span></div>
                </div>
              </div>
              {(
                f'<div class="speaker-stats-row" data-speaker-stats="total" data-primary="0">'
                f'  <div class="speaker-stats-kind">Total</div>'
                f'  <div class="speaker-stats-metrics">'
                f'    <div class="speaker-metric"><span class="speaker-metric-num">{total_count}</span><span class="speaker-metric-unit">eps</span></div>'
                f'    <div class="speaker-metric"><span class="speaker-metric-num">{total_pods}</span><span class="speaker-metric-unit">pods</span></div>'
                f'  </div>'
                f'</div>'
                if show_own_toggle
                else ''
              )}
            </div>
          </section>
          {speaker_feed_panel}
        </div>
        <p class="muted">Grouped by podcast (most appearances first).</p>
        <div class="speaker-groups">
          {"".join(groups_html) if groups_html else "<div class=\"muted\">No episodes indexed for this speaker.</div>"}
        </div>
        """.strip()
        _write_page(
            base_template=base_template,
            out_path=dist_dir / sp_page / "index.html",
            dist_dir=dist_dir,
            base_path=base_path,
            site_cfg=site_cfg,
            page_title=f"{speaker_h1} — {site_cfg.get('title') or ''}".strip(" —"),
            page_description=f"Episodes with {speaker_h1}",
            content_html=content,
            og_image=speaker_img_url or None,
        )

        if has_guest_feed:
            speaker_short = re.sub(r"\s+", " ", str(speaker_h1 or "").strip())[:60]
            channel_title = f"{speaker_short} — guest appearances"
            channel_link = _href(base_path, f"{sp_page}/")
            channel_link_abs = _abs_site_href(site_url_norm, channel_link) if site_url_norm else channel_link
            channel_desc = f"Most recent guest appearances for {speaker_short} (excluding podcasts they own)."
            last_build = _rss_pubdate(guest_eps[0].get("published_at")) or format_datetime(datetime.now(timezone.utc))

            items_xml: list[str] = []
            for e in guest_eps:
                ep_title = re.sub(r"\s+", " ", str(e.get("title") or "").strip())[:180]
                item_title = f"{speaker_short}: {ep_title}" if ep_title else speaker_short

                audio_url = _safe_http_href(str(e.get("audio_url") or ""))
                if not audio_url:
                    continue

                link_url = _safe_http_href(str(e.get("link_url") or "")) or _href(
                    base_path, f"{e.get('feed_slug') or ''}/?e={e.get('episode_key') or ''}"
                )
                if site_url_norm and link_url.startswith("/"):
                    link_url = _abs_site_href(site_url_norm, link_url)
                pub = _rss_pubdate(e.get("published_at")) or last_build
                guid = f"{e.get('feed_slug') or ''}:{e.get('episode_key') or ''}"
                length = int(e.get("enclosure_bytes") or 0) if isinstance(e.get("enclosure_bytes"), int) else 0
                typ = str(e.get("enclosure_type") or "audio/mpeg").strip() or "audio/mpeg"
                desc = str(e.get("description") or "").strip()
                desc_xml = f"<description>{_esc(desc)}</description>" if desc else ""
                dur = _fmt_time(e.get("duration_seconds"))
                dur_xml = f"<itunes:duration>{_esc(dur)}</itunes:duration>" if dur else ""
                img_url = _safe_http_href(str(e.get("episode_image_url") or e.get("feed_image_url") or ""))
                img_xml = f'<itunes:image href="{_esc(img_url)}" />' if img_url else ""

                items_xml.append(
                    f"""
                    <item>
                      <title>{_esc(item_title)}</title>
                      <link>{_esc(link_url)}</link>
                      <guid isPermaLink="false">{_esc(guid)}</guid>
                      <pubDate>{_esc(pub)}</pubDate>
                      {desc_xml}
                      {img_xml}
                      {dur_xml}
                      <enclosure url="{_esc(audio_url)}" length="{length}" type="{_esc(typ)}" />
                    </item>
                    """.strip()
                )

            rss_self = rss_abs or rss_path
            if site_url_norm and rss_self.startswith("/"):
                rss_self = _abs_site_href(site_url_norm, rss_self)
            rss_lines = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
                "<channel>",
                f"  <title>{_esc(channel_title)}</title>",
                f'  <atom:link href="{_esc(rss_self)}" rel="self" type="application/rss+xml" />',
                f"  <link>{_esc(channel_link_abs)}</link>",
                f"  <description>{_esc(channel_desc)}</description>",
                f"  <lastBuildDate>{_esc(last_build)}</lastBuildDate>",
                "  <ttl>360</ttl>",
            ]
            for item in items_xml[:50]:
                rss_lines.append("  " + item.replace("\n", "\n  "))
            rss_lines.extend(["</channel>", "</rss>", ""])
            (dist_dir / sp_page / "feed.xml").write_text("\n".join(rss_lines), encoding="utf-8")

    # Graph page (podcasts <-> speakers).
    graph_content = f"""
    <h1>Graph</h1>
    <p class="muted">A visual map of podcasts and speakers/topics. Work in progress.</p>
    <div class="graph-layout" id="graph-page" data-graph-page>
      <section class="card panel graph-controls">
        <div class="panel-head" style="margin-bottom:10px">
          <div class="panel-title"><strong>Filters</strong></div>
          <button class="btn btn-sm" type="button" data-graph-reset>Reset</button>
        </div>
        <label class="field">
          <div class="muted">Find</div>
          <input type="search" placeholder="Filter by name…" autocomplete="off" data-graph-filter />
        </label>
        <div class="graph-control-row">
          <label class="field" style="flex:1">
            <div class="muted">Min weight</div>
            <input type="range" min="1" max="10" value="2" step="1" data-graph-minweight />
          </label>
          <div class="muted" style="min-width:3ch;text-align:right" data-graph-minweight-readout>2</div>
        </div>
        <div class="graph-toggles">
          <label class="toggle toggle-pill" data-graph-toggle="supp">
            <input type="checkbox" />
            <span class="toggle-pill-ui" aria-hidden="true"></span>
            <span class="toggle-text">Include supplemental</span>
          </label>
          <label class="toggle toggle-pill" data-graph-toggle="own">
            <input type="checkbox" />
            <span class="toggle-pill-ui" aria-hidden="true"></span>
            <span class="toggle-text">Include own podcasts</span>
          </label>
        </div>
        <div class="muted graph-stats" data-graph-stats></div>
      </section>
      <section class="card panel graph-stage">
        <div class="graph-vis" data-graph-vis></div>
        <div class="muted graph-hint">Tip: tap a node to open its page.</div>
      </section>
    </div>
    <script type="application/json" id="graph-data">{_safe_json_for_html(graph_json)}</script>
    """.strip()
    _write_page(
        base_template=base_template,
        out_path=dist_dir / "graph" / "index.html",
        dist_dir=dist_dir,
        base_path=base_path,
        site_cfg=site_cfg,
        page_title=f"Graph — {site_cfg.get('title') or ''}".strip(" —"),
        page_description="Podcast/speaker connection graph",
        content_html=graph_content,
        include_og_image=False,
    )

    repo_stats = path_stats_tree(
        REPO_ROOT,
        exclude_dir_names={
            ".git",
            "node_modules",
            ".venv",
            "__pycache__",
        },
    )
    cache_stats = path_stats(cache_dir)
    dist_stats = path_stats(dist_dir)
    print(
        "[size] repo total: "
        f"{repo_stats['files']} files, {format_bytes(repo_stats['bytes'])} "
        f"(cache: {format_bytes(cache_stats['bytes'])} · dist: {format_bytes(dist_stats['bytes'])})"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
