from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


_HEADING_RE = re.compile(r"^(?P<level>#{1,6})\s+(?P<title>.+?)\s*$")
_KV_RE = re.compile(r"^(?:-\s*)?(?P<key>[A-Za-z0-9_./-]+)\s*:\s*(?P<val>.*)\s*$")


def _norm_key(key: str) -> str:
    return str(key or "").strip()


def _strip_comment(line: str) -> str:
    # Allow Markdown comments anywhere.
    if "<!--" in line:
        return line.split("<!--", 1)[0].rstrip()
    return line


def _split_list(value: str) -> list[str]:
    """
    Split a 1-line list. Accepts:
    - comma-separated
    - semicolon-separated
    - mixed (prefers semicolon as "stronger" separator)
    """
    s = str(value or "").strip()
    if not s:
        return []
    # Prefer semicolons when present (names often contain commas less often than semicolons).
    if ";" in s:
        parts = [p.strip() for p in s.split(";")]
    else:
        parts = [p.strip() for p in s.split(",")]
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        out.append(p)
    return out


def _parse_scalar(value: str) -> Any:
    s = str(value or "").strip()
    if s == "":
        return ""
    if s.lower() in ("true", "false"):
        return s.lower() == "true"
    if re.fullmatch(r"-?\d+", s):
        try:
            return int(s)
        except Exception:
            return s
    if re.fullmatch(r"-?\d+\.\d+", s):
        try:
            return float(s)
        except Exception:
            return s
    return s


@dataclass
class _Section:
    name: str
    level: int


def parse_feeds_markdown(text: str) -> dict[str, Any]:
    """
    Parse a feeds config written in conventional Markdown.

    Structure:

    # Site
    - title: ...
    - subtitle: ...
    - description: ...
    - base_path: /
    - footer_links: GitHub=https://github.com/; Docs=https://example.com/
    ## Home Intro
    (markdown body captured as site.home_intro_md)

    # Defaults
    - min_hours_between_checks: 2
    - max_episodes_per_feed: 1000
    ...

    # Feeds
    ## off-menu
    - url: https://...
    - title_override: ...
    - owners: A; B
    - common_speakers: ...
    - categories: comedy/british, interviews
    - notes: ...
    - editors_note: ...
    """
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")

    cfg: dict[str, Any] = {"site": {}, "defaults": {}, "feeds": []}
    site: dict[str, Any] = cfg["site"]
    defaults: dict[str, Any] = cfg["defaults"]

    current_top: str | None = None  # site/defaults/feeds
    current_feed: dict[str, Any] | None = None
    in_site_intro = False
    intro_lines: list[str] = []

    def flush_intro() -> None:
        nonlocal intro_lines
        if intro_lines:
            body = "\n".join(intro_lines).strip()
            if body:
                site["home_intro_md"] = body
        intro_lines = []

    for raw in lines:
        line = _strip_comment(raw).rstrip("\n")
        m = _HEADING_RE.match(line.strip())
        if m:
            flush_intro()
            in_site_intro = False
            level = len(m.group("level"))
            title = m.group("title").strip()
            title_l = title.lower()
            if level == 1:
                if title_l in ("site", "defaults", "feeds"):
                    current_top = title_l
                    current_feed = None
                else:
                    current_top = None
                    current_feed = None
            elif level == 2 and current_top == "site" and title_l in ("home intro", "home_intro", "intro"):
                in_site_intro = True
                current_feed = None
            elif level == 2 and current_top == "feeds":
                slug = title.strip()
                if not slug:
                    current_feed = None
                else:
                    current_feed = {"slug": slug}
                    cfg["feeds"].append(current_feed)
            else:
                current_feed = None
            continue

        if in_site_intro:
            intro_lines.append(raw)
            continue

        if line.strip() == "":
            continue

        km = _KV_RE.match(line)
        if not km:
            # Ignore free-form content for now (keeps config strict/predictable).
            continue

        key = _norm_key(km.group("key"))
        val_raw = km.group("val")

        target: dict[str, Any] | None
        if current_top == "site":
            target = site
        elif current_top == "defaults":
            target = defaults
        elif current_top == "feeds" and current_feed is not None:
            target = current_feed
        else:
            target = None

        if target is None:
            continue

        key_l = key.lower()

        if key_l in ("owners", "owner", "common_speakers", "commonSpeakers".lower(), "categories", "category"):
            items = _split_list(val_raw)
            if key_l in ("owner",):
                key = "owners"
            if key_l in ("category",):
                key = "categories"
            if key_l == "commonspeakers":
                key = "common_speakers"
            target[key] = items
            continue

        if key_l in ("footer_links", "footer_link"):
            # footer_links: Label=https://...; Label2=https://...
            pairs = _split_list(val_raw)
            links: list[dict[str, str]] = []
            for p in pairs:
                if "=" not in p:
                    continue
                label, href = p.split("=", 1)
                label = label.strip()
                href = href.strip()
                if not label or not href:
                    continue
                links.append({"label": label, "href": href})
            # footer_link is additive; footer_links replaces.
            if key_l == "footer_link":
                existing = target.get("footer_links")
                if not isinstance(existing, list):
                    existing = []
                target["footer_links"] = list(existing) + links
            else:
                target["footer_links"] = links
            continue

        target[key] = _parse_scalar(val_raw)

    flush_intro()

    # Normalize: drop empty site/defaults if not provided.
    if not isinstance(cfg.get("feeds"), list):
        cfg["feeds"] = []
    if not isinstance(cfg.get("defaults"), dict):
        cfg["defaults"] = {}
    if not isinstance(cfg.get("site"), dict):
        cfg["site"] = {}
    return cfg


def dumps_feeds_markdown(cfg: dict[str, Any]) -> str:
    """
    Convert the JSON-style feeds config into a conventional Markdown config.
    """
    cfg = cfg or {}
    site = cfg.get("site") if isinstance(cfg.get("site"), dict) else {}
    defaults = cfg.get("defaults") if isinstance(cfg.get("defaults"), dict) else {}
    feeds = cfg.get("feeds") if isinstance(cfg.get("feeds"), list) else []

    def kv(key: str, value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            v = "true" if value else "false"
        else:
            v = str(value)
        return f"- {key}: {v}"

    out: list[str] = []

    out.append("# Site")
    for k in ("title", "subtitle", "description", "base_path"):
        v = site.get(k)
        if v is None or str(v).strip() == "":
            continue
        out.append(kv(k, v))
    footer_links = site.get("footer_links") or []
    if isinstance(footer_links, list) and footer_links:
        parts: list[str] = []
        for link in footer_links:
            if not isinstance(link, dict):
                continue
            label = str(link.get("label") or "").strip()
            href = str(link.get("href") or "").strip()
            if label and href:
                parts.append(f"{label}={href}")
        if parts:
            out.append(kv("footer_links", "; ".join(parts)))

    home_intro_md = str(site.get("home_intro_md") or "").strip()
    if home_intro_md:
        out.append("")
        out.append("## Home Intro")
        out.append(home_intro_md)

    out.append("")
    out.append("# Defaults")
    for k in sorted(defaults.keys()):
        out.append(kv(k, defaults.get(k)))

    out.append("")
    out.append("# Feeds")

    def fmt_list(values: Any, *, sep: str) -> str:
        if not values:
            return ""
        if isinstance(values, str):
            return values.strip()
        if isinstance(values, list):
            return sep.join([str(v).strip() for v in values if str(v).strip()])
        return str(values).strip()

    # Stable per-feed key ordering: the known keys first, then the rest alphabetically.
    known = [
        "url",
        "title_override",
        "owners",
        "common_speakers",
        "categories",
        "notes",
        "editors_note",
    ]
    for feed in feeds:
        if not isinstance(feed, dict):
            continue
        slug = str(feed.get("slug") or "").strip()
        if not slug:
            continue
        out.append("")
        out.append(f"## {slug}")

        keys = [k for k in known if k in feed]
        extras = sorted([k for k in feed.keys() if k not in keys and k != "slug"])
        for k in keys + extras:
            v = feed.get(k)
            if v is None or (isinstance(v, str) and v.strip() == ""):
                continue
            if k in ("owners", "common_speakers"):
                out.append(kv(k, fmt_list(v, sep="; ")))
            elif k == "categories":
                out.append(kv(k, fmt_list(v, sep=", ")))
            else:
                out.append(kv(k, v))

    return "\n".join(out).rstrip() + "\n"
