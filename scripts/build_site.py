from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.shared import REPO_ROOT, format_bytes, path_stats, path_stats_tree, read_json, slugify, write_json
from scripts.shared import sanitize_speakers, sanitize_topics

PLACEHOLDER_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build static HTML site from cached feed markdown.")
    p.add_argument("--site", default="site.json", help="Path to site config JSON.")
    p.add_argument("--feeds", default="feeds.json", help="Path to feeds config JSON (for ordering).")
    p.add_argument("--cache", default="cache", help="Cache directory.")
    p.add_argument("--dist", default="dist", help="Output directory.")
    p.add_argument("--templates", default="site/templates", help="Templates directory.")
    p.add_argument("--assets", default="site/assets", help="Assets directory to copy into dist/assets.")
    p.add_argument("--base-path", default=None, help="Override base_path (useful for local dev).")
    return p.parse_args()


def _esc(text: str | None) -> str:
    return html.escape(text or "", quote=True)


def _norm_base_path(value: str | None) -> str:
    value = (value or "/").strip()
    if not value.startswith("/"):
        value = "/" + value
    if not value.endswith("/"):
        value += "/"
    return value


def _href(base_path: str, path: str) -> str:
    return base_path + path.lstrip("/")


def _load_template(path: Path) -> str:
    return path.read_text(encoding="utf-8")


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


def _fmt_size(bytes_value: int | None) -> str:
    if not bytes_value:
        return "?MB"
    return format_bytes(int(bytes_value))


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


def _write_page(
    *,
    base_template: str,
    out_path: Path,
    base_path: str,
    site_cfg: dict[str, Any],
    page_title: str,
    page_description: str,
    content_html: str,
) -> None:
    footer_links = site_cfg.get("footer_links") or []
    footer_parts: list[str] = []
    for link in footer_links:
        label = _esc(str(link.get("label") or "link"))
        href = _esc(str(link.get("href") or "#"))
        footer_parts.append(f'<a href="{href}" rel="noopener">{label}</a>')
    footer_html = " · ".join(footer_parts) if footer_parts else ""

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
            "content": content_html,
            "footer": footer_html,
        },
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(doc, encoding="utf-8")


def main() -> int:
    args = _parse_args()

    site_cfg = read_json(REPO_ROOT / args.site)
    feeds_cfg = read_json(REPO_ROOT / args.feeds)

    cache_dir = REPO_ROOT / args.cache
    feeds_dir = cache_dir / "feeds"
    dist_dir = REPO_ROOT / args.dist
    templates_dir = REPO_ROOT / args.templates
    assets_dir = REPO_ROOT / args.assets

    base_override = args.base_path or __import__("os").environ.get("AP_BASE_PATH")
    base_path = _norm_base_path(base_override if base_override is not None else site_cfg.get("base_path"))

    base_template = _load_template(templates_dir / "base.html")

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
    owner_slugs_by_feed: dict[str, set[str]] = {}
    for f in feeds_cfg.get("feeds") or []:
        slug = str(f.get("slug") or "")
        if not slug:
            continue
        feed_order.append(slug)
        owners = sanitize_speakers(_norm_name_list(f.get("owners") or f.get("owner")))
        common_speakers = sanitize_speakers(_norm_name_list(f.get("common_speakers") or f.get("commonSpeakers")))
        feed_tags[slug] = {"owners": owners, "common_speakers": common_speakers}
        owner_slugs_by_feed[slug] = {slugify(n) for n in owners}

    if not feed_order:
        print("[warn] No feeds configured; generating an empty site.", file=sys.stderr)

    feeds: list[dict[str, Any]] = []
    for slug in feed_order:
        md_path = feeds_dir / f"{slug}.md"
        feed = _load_feed_cache_json(md_path)
        if not feed:
            feeds.append(
                {
                    "slug": slug,
                    "title": slug,
                    "description": "",
                    "episodes": [],
                    "missing_cache": True,
                }
            )
            continue

        cfg_tags = feed_tags.get(slug) or {}
        cfg_owners = cfg_tags.get("owners") or []
        cfg_common = cfg_tags.get("common_speakers") or []
        owners = sanitize_speakers(cfg_owners)
        common_speakers = sanitize_speakers(cfg_common)
        feed["owners"] = owners
        feed["common_speakers"] = common_speakers
        owner_slugs_by_feed[slug] = {slugify(n) for n in owners}
        always = common_speakers + owners
        for ep in feed.get("episodes") or []:
            ep["speakers"] = _merge_always_speakers(detected=ep.get("speakers"), always=always, limit=12)
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
            episode_key = ep.get("key")
            ep_entry = {
                "feed_slug": feed_slug,
                "feed_title": feed_title,
                "feed_image_url": feed_image_url,
                "episode_key": episode_key,
                "title": ep.get("title"),
                "published_at": ep.get("published_at"),
                "episode_image_url": ep.get("image_url"),
                "audio_url": ep.get("enclosure_url"),
                "link_url": ep.get("link"),
                "duration_seconds": dur_seconds,
                "enclosure_bytes": enclosure_bytes,
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

    # Home page.
    feed_cards = []
    for feed in feeds:
        slug = str(feed.get("slug") or "")
        title = _esc(str(feed.get("title") or slug))
        desc = _esc(str(feed.get("description") or ""))
        image_url = str(feed.get("image_url") or "").strip()
        hue = _hue_from_slug(slug)
        initials = "".join([p[0].upper() for p in str(feed.get("title") or slug).split()[:2] if p])[:2] or "P"
        missing = feed.get("missing_cache")
        missing_note = (
            '<div class="muted">No cache yet (run update script / wait for Action).</div>' if missing else ""
        )
        cover = (
            f'<img src="{_esc(image_url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
            if image_url
            else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
        )
        feed_cards.append(
            f"""
            <section class="card feed-card" data-feed-slug="{_esc(slug)}">
              <a class="feed-cover" href="{_esc(_href(base_path, f"podcasts/{slug}/"))}">
                {cover}
              </a>
              <div class="feed-body">
                <h2><a href="{_esc(_href(base_path, f"podcasts/{slug}/"))}">{title}</a></h2>
                <div class="muted feed-desc">{desc}</div>
                {missing_note}
              </div>
            </section>
            """.strip()
        )

    podcasts_html = (
        "".join(feed_cards)
        if feed_cards
        else '<div class="muted">No podcasts configured in <code>feeds.json</code>.</div>'
    )

    recent = all_episodes_index[:50]
    recent_items = []
    for e in recent:
        feed_slug = e.get("feed_slug") or ""
        key = e.get("episode_key") or ""
        episode_id = f"{feed_slug}:{key}"
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
            f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(img_url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
            if img_url
            else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
        )
        url = _href(base_path, f"podcasts/{feed_slug}/?e={key}")
        meta_bits = [feed_title, date]
        if dur_text:
            meta_bits.append(dur_text)
        meta_bits.append(size_text)
        meta_line = " · ".join([m for m in meta_bits if m])
        recent_items.append(
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

    content = f"""
    <h1>{_esc(site_cfg.get("title") or "Podcast Index")}</h1>
    <p class="muted">{_esc(site_cfg.get("description") or "")}</p>
    <div class="home-layout">
      <aside class="home-side">
        <section class="card panel" id="home-history">
          <div class="panel-head">
            <h2>History</h2>
          </div>
          <div class="muted" data-empty>Nothing yet.</div>
          <ul class="list" data-history-list></ul>
        </section>
        <section class="card panel" id="home-queue">
          <div class="panel-head">
            <h2>Queue</h2>
          </div>
          <div class="muted" data-empty>Queue is empty.</div>
          <ul class="list" data-queue-list></ul>
        </section>
        <section class="card panel" id="home-latest">
          <div class="panel-head">
            <h2>Latest</h2>
          </div>
          <ul class="list" data-latest-list>
            {"".join(recent_items) if recent_items else "<li class=\"muted\">No episodes yet.</li>"}
          </ul>
        </section>
      </aside>
      <section class="home-main">
        <h2>Podcasts</h2>
        <div class="grid feed-grid">{podcasts_html}</div>
      </section>
    </div>
    """.strip()
    _write_page(
        base_template=base_template,
        out_path=dist_dir / "index.html",
        base_path=base_path,
        site_cfg=site_cfg,
        page_title=str(site_cfg.get("title") or "Podcast Index"),
        page_description=str(site_cfg.get("description") or ""),
        content_html=content,
    )

    # Feed pages.
    for feed in feeds:
        slug = str(feed.get("slug") or "")
        title = str(feed.get("title") or slug)
        episodes_html = []
        for ep in feed.get("episodes") or []:
            key = str(ep.get("key") or "")
            episode_id = f"{slug}:{key}"
            ep_title = _esc(str(ep.get("title") or ""))
            date = _esc(str((ep.get("published_at") or "")[:10]))
            audio = _esc(str(ep.get("enclosure_url") or ""))
            link = _esc(str(ep.get("link") or ""))
            dur_seconds = _duration_seconds(ep.get("itunes_duration"))
            bytes_value = _parse_int(ep.get("enclosure_length") or ep.get("enclosure_bytes"))
            img_url = str((ep.get("image_url") or feed.get("image_url") or "")).strip()
            hue = _hue_from_slug(str(slug))
            initials = "".join([p[0].upper() for p in str(feed.get("title") or slug).split()[:2] if p])[:2] or "P"
            art = (
                f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(img_url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
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
                sp_slug = slugify(str(sp))
                speaker_links.append(
                    f'<a class="tag" href="{_esc(_href(base_path, f"speakers/{sp_slug}/"))}">{_esc(str(sp))}</a>'
                )
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
                    <button class="btn-primary btn-sm" type="button" data-action="play">Play</button>
                    <button class="btn btn-sm queue-btn" type="button" data-action="queue">Queue</button>
                    <details class="menu">
                      <summary class="btn btn-sm" aria-label="More actions">⋯</summary>
                      <div class="menu-panel card">
                        <button class="btn btn-sm" type="button" data-action="played">Mark played</button>
                        <button class="btn btn-sm" type="button" data-action="offline">Offline</button>
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
        content = f"""
        <h1>{_esc(title)}</h1>
        <p class="muted">{_esc(feed_desc)}</p>
        <p><a href="{_esc(feed_link)}" rel="noopener">Official link</a></p>
        <ul class="episodes">
          {"".join(episodes_html) if episodes_html else '<li class="muted">No cached episodes yet.</li>'}
        </ul>
        """.strip()
        _write_page(
            base_template=base_template,
            out_path=dist_dir / "podcasts" / slug / "index.html",
            base_path=base_path,
            site_cfg=site_cfg,
            page_title=f"{title} — {site_cfg.get('title') or ''}".strip(" —"),
            page_description=feed_desc,
            content_html=content,
        )

    # Speaker index + pages.
    speaker_rows = []
    for sp_slug, eps_by_id in speaker_eps_by_slug.items():
        speaker = speaker_name_by_slug.get(sp_slug) or sp_slug
        eps = list(eps_by_id.values())
        total = len(eps)
        guest = 0
        for e in eps:
            feed_slug = str(e.get("feed_slug") or "")
            owners = owner_slugs_by_feed.get(feed_slug) or set()
            if sp_slug in owners:
                continue
            guest += 1
        speaker_rows.append((sp_slug, speaker, guest, total))
    # Default: sort by guest appearances (exclude own podcasts).
    speaker_rows.sort(key=lambda r: (-r[2], -r[3], r[1].lower()))

    speaker_list_items = []
    for sp_slug, speaker, guest_count, total_count in speaker_rows[:500]:
        url = _href(base_path, f"speakers/{sp_slug}/")
        speaker_list_items.append(
            f'<li data-speaker-row data-count-guest="{guest_count}" data-count-total="{total_count}" data-name="{_esc(speaker)}">'
            f'<a href="{_esc(url)}">{_esc(speaker)}</a> '
            f'<span class="muted">(<span data-speaker-count>{guest_count}</span>)</span>'
            f"</li>"
        )

    content = f"""
    <h1>Speakers</h1>
    <p class="muted">Heuristic extraction from titles/descriptions. Expect some noise.</p>
    <div class="card panel" style="margin:12px 0">
      <div class="panel-head">
        <h2>Counting</h2>
      </div>
      <label class="toggle"><input id="speakers-include-own" type="checkbox" /> Include own podcasts</label>
      <div class="muted" style="margin-top:8px">Default counts exclude episodes from podcasts the speaker owns (as configured in <code>feeds.json</code>).</div>
    </div>
    <ul class="list">
      {"".join(speaker_list_items) if speaker_list_items else "<li class=\"muted\">No speakers yet.</li>"}
    </ul>
    """.strip()
    _write_page(
        base_template=base_template,
        out_path=dist_dir / "speakers" / "index.html",
        base_path=base_path,
        site_cfg=site_cfg,
        page_title=f"Speakers — {site_cfg.get('title') or ''}".strip(" —"),
        page_description="Speaker index",
        content_html=content,
    )

    for sp_slug, speaker, guest_count, total_count in speaker_rows[:500]:
        eps = list((speaker_eps_by_slug.get(sp_slug) or {}).values())
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
                    f'<img src="{PLACEHOLDER_IMG}" data-src="{_esc(img_url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
                    if img_url
                    else f'<div class="cover-fallback" style="--cover-hue: {hue}">{_esc(initials)}</div>'
                )
                url = _href(base_path, f"podcasts/{feed_slug}/?e={key}")
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

            podcast_url = _href(base_path, f"podcasts/{feed_slug}/")
            groups_html.append(
                f"""
                <details class="speaker-group card" open data-own="{'1' if is_own else '0'}" {'hidden' if is_own else ''}>
                  <summary>
                    <span class="speaker-group-title">{feed_title}</span>
                    <span class="muted">({len(group_eps)})</span>
                  </summary>
                  <div class="muted speaker-group-meta">
                    <a href="{_esc(podcast_url)}">Open podcast</a>
                  </div>
                  <ul class="list">
                    {"".join(items)}
                  </ul>
                </details>
                """.strip()
            )
        content = f"""
        <h1>{_esc(speaker)}</h1>
        <div class="card panel" style="margin:12px 0">
          <div class="panel-head">
            <h2>Counting</h2>
          </div>
          <label class="toggle"><input id="speaker-include-own" type="checkbox" /> Include own podcasts</label>
          <div class="muted" style="margin-top:8px">Guest appearances: <strong>{guest_count}</strong> · Total: <strong>{total_count}</strong></div>
        </div>
        <p class="muted">Grouped by podcast (most appearances first).</p>
        <div class="speaker-groups">
          {"".join(groups_html) if groups_html else "<div class=\"muted\">No episodes indexed for this speaker.</div>"}
        </div>
        """.strip()
        _write_page(
            base_template=base_template,
            out_path=dist_dir / "speakers" / sp_slug / "index.html",
            base_path=base_path,
            site_cfg=site_cfg,
            page_title=f"{speaker} — {site_cfg.get('title') or ''}".strip(" —"),
            page_description=f"Episodes with {speaker}",
            content_html=content,
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
