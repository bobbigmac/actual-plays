from __future__ import annotations

import argparse
import html
import json
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.shared import REPO_ROOT, read_json, slugify, write_json


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

    for asset in assets_dir.glob("*"):
        if asset.is_file():
            shutil.copy2(asset, dist_dir / "assets" / asset.name)

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
    for f in feeds_cfg.get("feeds") or []:
        if f.get("slug"):
            feed_order.append(str(f["slug"]))

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
        feeds.append(feed)

    # Build speaker index.
    speaker_to_eps: dict[str, list[dict[str, Any]]] = defaultdict(list)
    all_episodes_index: list[dict[str, Any]] = []
    for feed in feeds:
        feed_slug = feed.get("slug") or ""
        feed_title = feed.get("title") or feed_slug
        for ep in feed.get("episodes") or []:
            speakers = ep.get("speakers") or []
            ep_entry = {
                "feed_slug": feed_slug,
                "feed_title": feed_title,
                "episode_key": ep.get("key"),
                "title": ep.get("title"),
                "published_at": ep.get("published_at"),
                "speakers": speakers,
                "topics": ep.get("topics") or [],
            }
            all_episodes_index.append(ep_entry)
            for sp in speakers:
                speaker_to_eps[str(sp)].append(ep_entry)

    # Sort index by date desc.
    all_episodes_index.sort(key=lambda e: e.get("published_at") or "", reverse=True)

    # Emit search index JSON (lazy-loaded by the client).
    index_json = []
    for e in all_episodes_index:
        if not e.get("episode_key"):
            continue
        index_json.append(
            {
                "k": e["episode_key"],
                "t": e.get("title") or "",
                "d": (e.get("published_at") or "")[:10],
                "f": e.get("feed_slug") or "",
                "ft": e.get("feed_title") or "",
                "s": e.get("speakers") or [],
                "x": e.get("topics") or [],
            }
        )
    write_json(dist_dir / "index.json", index_json)
    write_json(dist_dir / "site.json", site_cfg)

    # Home page.
    feed_cards = []
    for feed in feeds:
        slug = str(feed.get("slug") or "")
        title = _esc(str(feed.get("title") or slug))
        desc = _esc(str(feed.get("description") or ""))
        missing = feed.get("missing_cache")
        missing_note = (
            '<div class="muted">No cache yet (run update script / wait for Action).</div>' if missing else ""
        )
        feed_cards.append(
            f"""
            <section class="card">
              <h2><a href="{_esc(_href(base_path, f"podcasts/{slug}/"))}">{title}</a></h2>
              <div class="muted">{desc}</div>
              {missing_note}
            </section>
            """.strip()
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
        url = _href(base_path, f"podcasts/{feed_slug}/?e={key}")
        recent_items.append(
            f"""
            <li class="episode-row" data-episode-id="{_esc(episode_id)}">
              <a href="{_esc(url)}">{title}</a>
              <span class="muted">({feed_title} · {date})</span>
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
    <div class="grid">
      {"".join(feed_cards)}
    </div>
    <h2>Recent episodes</h2>
    <ul class="list">
      {"".join(recent_items) if recent_items else "<li class=\"muted\">No episodes yet.</li>"}
    </ul>
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
            desc_full = str(ep.get("description") or "")
            desc_snip = _snippet(desc_full, limit=360)
            has_more = bool(desc_full and len(desc_full) > len(desc_snip))
            dur = _esc(str(ep.get("itunes_duration") or ""))
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
                  data-episode-link="{link}">
                  <button class="play" type="button" data-play>Play</button>
                  <div class="meta">
                    <div class="title">{ep_title}</div>
                    <div class="sub muted">{date} {dur_html} {ext_link_html}</div>
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
        <section class="player card" data-player>
          <audio id="player" preload="metadata"></audio>
          <div class="player-top">
            <button class="btn-primary" type="button" id="btn-playpause" aria-label="Play/Pause">Play</button>
            <button class="btn" type="button" id="btn-back15" aria-label="Back 15 seconds">-15</button>
            <button class="btn" type="button" id="btn-fwd30" aria-label="Forward 30 seconds">+30</button>
            <div class="player-meta">
              <div id="now-title" class="now-title">Select an episode to play.</div>
              <div id="now-sub" class="now-sub muted"></div>
            </div>
            <select class="speed" id="speed" aria-label="Playback speed">
              <option value="0.75">0.75x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="1.75">1.75x</option>
              <option value="2">2x</option>
              <option value="2.5">2.5x</option>
              <option value="3">3x</option>
              <option value="4">4x</option>
              <option value="5">5x</option>
            </select>
          </div>
          <div class="player-scrub">
            <span class="time muted" id="t-elapsed">0:00</span>
            <input id="scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek" />
            <span class="time muted" id="t-duration">0:00</span>
          </div>
          <details class="player-audio">
            <summary class="muted">Audio settings</summary>
            <div class="audio-controls">
              <label class="toggle">
                <input id="preserve-pitch" type="checkbox" checked />
                Preserve pitch
              </label>
              <div class="eq-row">
                <label class="slider">
                  Gain <span class="muted" id="gain-val">0 dB</span>
                  <input id="gain" type="range" min="-12" max="12" value="0" step="1" />
                </label>
                <label class="slider">
                  Bass <span class="muted" id="eq-low-val">0 dB</span>
                  <input id="eq-low" type="range" min="-12" max="12" value="0" step="1" />
                </label>
                <label class="slider">
                  Mid <span class="muted" id="eq-mid-val">0 dB</span>
                  <input id="eq-mid" type="range" min="-12" max="12" value="0" step="1" />
                </label>
                <label class="slider">
                  Treble <span class="muted" id="eq-high-val">0 dB</span>
                  <input id="eq-high" type="range" min="-12" max="12" value="0" step="1" />
                </label>
              </div>
            </div>
          </details>
        </section>
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
    for speaker, eps in speaker_to_eps.items():
        speaker_rows.append((speaker, len(eps)))
    speaker_rows.sort(key=lambda r: (-r[1], r[0].lower()))

    speaker_list_items = []
    for speaker, count in speaker_rows[:500]:
        sp_slug = slugify(speaker)
        url = _href(base_path, f"speakers/{sp_slug}/")
        speaker_list_items.append(
            f'<li><a href="{_esc(url)}">{_esc(speaker)}</a> <span class="muted">({count})</span></li>'
        )

    content = f"""
    <h1>Speakers</h1>
    <p class="muted">Heuristic extraction from titles/descriptions. Expect some noise.</p>
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

    for speaker, _count in speaker_rows[:500]:
        sp_slug = slugify(speaker)
        eps = speaker_to_eps.get(speaker) or []
        eps.sort(key=lambda e: e.get("published_at") or "", reverse=True)
        items = []
        for e in eps[:500]:
            feed_slug = e.get("feed_slug") or ""
            feed_title = _esc(e.get("feed_title") or feed_slug)
            key = e.get("episode_key") or ""
            episode_id = f"{feed_slug}:{key}"
            title = _esc(e.get("title") or "")
            date = _esc((e.get("published_at") or "")[:10])
            url = _href(base_path, f"podcasts/{feed_slug}/?e={key}")
            items.append(
                f"""
                <li class="episode-row" data-episode-id="{_esc(episode_id)}">
                  <a href="{_esc(url)}">{title}</a>
                  <span class="muted">({feed_title} · {date})</span>
                  <div class="mini-progress">
                    <div class="mini-progress-bar" data-progress-bar></div>
                  </div>
                  <div class="mini-progress-text muted" data-progress-text></div>
                </li>
                """.strip()
            )
        content = f"""
        <h1>{_esc(speaker)}</h1>
        <ul class="list">
          {"".join(items) if items else "<li class=\"muted\">No episodes indexed for this speaker.</li>"}
        </ul>
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

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
