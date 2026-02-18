from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from scripts.shared import (
    REPO_ROOT,
    extract_speakers,
    extract_topics,
    fetch_url,
    parse_feed,
    read_json,
    sanitize_speakers,
    sanitize_topics,
    stable_episode_key,
    utc_now_iso,
    write_json,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch RSS/Atom feeds and update cache markdown.")
    p.add_argument("--feeds", default="feeds.json", help="Path to feeds config JSON.")
    p.add_argument("--cache", default="cache", help="Cache directory.")
    p.add_argument("--force", action="store_true", help="Ignore cooldown and refetch all feeds.")
    p.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of feeds to fetch concurrently (default: 4).",
    )
    p.add_argument(
        "--sanitize-cache",
        action="store_true",
        help="Rewrite existing cached markdown by re-sanitizing speakers/topics without fetching.",
    )
    p.add_argument(
        "--only",
        default=None,
        help="Only operate on a single feed slug (works with --sanitize-cache or fetching).",
    )
    p.add_argument("--quiet", action="store_true", help="Less logging (still prints errors).")
    return p.parse_args()


def _log(msg: str, *, quiet: bool) -> None:
    if not quiet:
        print(msg)


def _load_existing_feed_json(md_path: Path) -> dict | None:
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


def _infer_last_checked_unix_from_cache(md_path: Path) -> int | None:
    """
    If state.json is missing (common in new clones), derive a cooldown timestamp from
    the cached markdown's embedded JSON (fetched_at or published fetched_at).
    """
    feed = _load_existing_feed_json(md_path)
    if not isinstance(feed, dict):
        return None
    fetched_at = feed.get("fetched_at") or feed.get("fetchedAt") or feed.get("updated_at")
    if not fetched_at or not isinstance(fetched_at, str):
        return None
    try:
        s = fetched_at.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def _render_cache_markdown(
    *,
    feed_slug: str,
    fetched_at: str,
    etag: str | None,
    last_modified: str | None,
    feed: dict,
    defaults: dict,
) -> str:
    title = feed.get("title") or feed.get("source_url") or feed_slug
    source_url = feed.get("source_url") or ""

    lines: list[str] = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"- slug: `{feed_slug}`")
    lines.append(f"- source: `{source_url}`")
    lines.append(f"- fetched_at: `{fetched_at}`")
    if etag:
        lines.append(f"- etag: `{etag}`")
    if last_modified:
        lines.append(f"- last_modified: `{last_modified}`")
    lines.append(f"- max_episodes_per_feed: `{defaults.get('max_episodes_per_feed')}`")
    lines.append("")
    lines.append("<!-- FEED_JSON -->")
    lines.append("```json")
    lines.append(json.dumps(feed, ensure_ascii=False, indent=2))
    lines.append("```")
    lines.append("<!-- /FEED_JSON -->")
    lines.append("")
    lines.append("## Episodes (newest first)")
    lines.append("")
    for ep in feed.get("episodes", []):
        date = (ep.get("published_at") or "")[:10]
        title = ep.get("title") or "(untitled)"
        speakers = ep.get("speakers") or []
        speaker_text = f" — speakers: {', '.join(speakers)}" if speakers else ""
        lines.append(f"- {date} — {title}{speaker_text}")
    lines.append("")
    return "\n".join(lines)


def _try_tag_with_compromise(items: list[dict], *, quiet: bool) -> dict[str, dict] | None:
    """
    Runs `node scripts/tag_compromise.mjs` to extract speakers/topics with compromise.
    Returns a dict: episode_key -> {speakers: [...], topics: [...]} or None if unavailable.
    """
    node = shutil.which("node")
    script_path = REPO_ROOT / "scripts" / "tag_compromise.mjs"
    if not node or not script_path.exists():
        return None
    try:
        proc = subprocess.run(
            [node, str(script_path)],
            input=json.dumps({"items": items}, ensure_ascii=False).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            cwd=str(REPO_ROOT),
            timeout=30,
        )
    except Exception as e:
        if not quiet:
            print(f"[warn] compromise tagger failed to run: {e}", file=sys.stderr)
        return None

    if proc.returncode != 0:
        if not quiet:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            print(f"[warn] compromise tagger non-zero exit ({proc.returncode}): {err}", file=sys.stderr)
        return None
    try:
        return json.loads(proc.stdout.decode("utf-8"))
    except Exception:
        return None


@dataclass(frozen=True)
class _FeedJob:
    slug: str
    url: str
    feed_title: str | None
    feed_min_hours: int
    feed_max_episodes: int


@dataclass
class _FeedResult:
    slug: str
    per_feed_state: dict
    changed: bool
    wrote_cache: bool


def _process_one_feed(
    job: _FeedJob,
    *,
    feeds_md_dir: Path,
    defaults: dict,
    timeout_seconds: int,
    user_agent: str,
    quiet: bool,
    per_feed_state: dict,
    now_iso: str,
) -> _FeedResult:
    slug = job.slug
    url = job.url

    def _err(msg: str) -> None:
        print(msg, file=sys.stderr)

    md_path = feeds_md_dir / f"{slug}.md"
    prev_json = _load_existing_feed_json(md_path) or {}

    etag = per_feed_state.get("etag")
    last_modified = per_feed_state.get("last_modified")

    try:
        result = fetch_url(
            url,
            timeout_seconds=timeout_seconds,
            user_agent=user_agent,
            if_none_match=etag,
            if_modified_since=last_modified,
        )
    except Exception as e:
        _err(f"[error] {slug} fetch failed: {e}")
        per_feed_state["last_checked_at"] = now_iso
        per_feed_state["last_checked_unix"] = int(time.time())
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=False, wrote_cache=False)

    per_feed_state["last_checked_at"] = now_iso
    per_feed_state["last_checked_unix"] = int(time.time())

    if result.status == 304:
        if not quiet:
            print(f"[unchanged] {slug}")
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=False, wrote_cache=False)

    if not result.content:
        if not quiet:
            print(f"[warn] {slug} empty response")
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=False, wrote_cache=False)

    try:
        parsed = parse_feed(result.content, source_url=url)
    except Exception as e:
        _err(f"[error] {slug} parse failed: {e}")
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=False, wrote_cache=False)

    feed_title = job.feed_title or parsed.get("title") or slug
    episodes_raw = parsed.get("items", [])

    pre = []
    for item in episodes_raw[: job.feed_max_episodes * 2]:
        title = item.get("title") or ""
        published_at = item.get("published_at")
        description = item.get("description") or ""
        enclosure_url = item.get("enclosure_url")
        key = stable_episode_key(
            guid=item.get("guid"),
            enclosure_url=enclosure_url,
            title=title,
            published_at=published_at,
        )
        pre.append(
            {
                "key": key,
                "title": title,
                "published_at": published_at,
                "link": item.get("link"),
                "description": description,
                "enclosure_url": enclosure_url,
                "enclosure_type": item.get("enclosure_type"),
                "itunes_duration": item.get("itunes_duration"),
            }
        )

    compromise_items = [{"id": ep["key"], "title": ep["title"], "description": ep["description"]} for ep in pre]
    compromise_tags = _try_tag_with_compromise(compromise_items, quiet=quiet)

    episodes = []
    for ep in pre:
        key = ep["key"]
        title = ep["title"]
        description = ep["description"]
        combined_text = f"{title}\n{description}"

        tags = (compromise_tags or {}).get(key) if compromise_tags else None
        speakers = tags.get("speakers") if isinstance(tags, dict) else None
        topics = tags.get("topics") if isinstance(tags, dict) else None
        if not isinstance(speakers, list) or not speakers:
            speakers = extract_speakers(combined_text)
        if not isinstance(topics, list) or not topics:
            topics = extract_topics(title)

        episodes.append(
            {
                **ep,
                "speakers": sanitize_speakers(speakers),
                "topics": sanitize_topics(topics),
            }
        )

    episodes.sort(key=lambda e: e.get("published_at") or "", reverse=True)
    episodes = episodes[: job.feed_max_episodes]

    feed_json = {
        "version": 1,
        "slug": slug,
        "source_url": url,
        "title": feed_title,
        "link": parsed.get("link"),
        "description": parsed.get("description") or "",
        "image_url": parsed.get("image_url"),
        "fetched_at": now_iso,
        "episodes": episodes,
    }

    if result.etag:
        per_feed_state["etag"] = result.etag
    if result.last_modified:
        per_feed_state["last_modified"] = result.last_modified

    prev_sig = json.dumps(prev_json, sort_keys=True, ensure_ascii=False)
    next_sig = json.dumps(feed_json, sort_keys=True, ensure_ascii=False)
    if prev_sig == next_sig:
        if not quiet:
            print(f"[no-op] {slug}")
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=False, wrote_cache=False)

    feeds_md_dir.mkdir(parents=True, exist_ok=True)
    md = _render_cache_markdown(
        feed_slug=slug,
        fetched_at=now_iso,
        etag=per_feed_state.get("etag"),
        last_modified=per_feed_state.get("last_modified"),
        feed=feed_json,
        defaults=defaults,
    )
    md_path.write_text(md, encoding="utf-8")
    if not quiet:
        print(f"[updated] {slug} -> {md_path}")
    return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=True, wrote_cache=True)


def main() -> int:
    args = _parse_args()
    feeds_path = REPO_ROOT / args.feeds
    cache_dir = REPO_ROOT / args.cache
    state_path = cache_dir / "state.json"
    feeds_md_dir = cache_dir / "feeds"

    cfg = read_json(feeds_path)
    defaults = cfg.get("defaults", {})
    min_hours_between_checks = int(defaults.get("min_hours_between_checks", 6))
    max_episodes_per_feed = int(defaults.get("max_episodes_per_feed", 200))
    timeout_seconds = int(defaults.get("request_timeout_seconds", 25))
    user_agent = str(defaults.get("user_agent", "actual-plays-static-podcast-index/1.0"))

    state = read_json(state_path) if state_path.exists() else {}
    state.setdefault("feeds", {})

    any_changed = False
    now_iso = utc_now_iso()

    feeds = cfg.get("feeds") or []
    if not feeds:
        print("No feeds configured in feeds.json", file=sys.stderr)
        return 1

    if args.only:
        feeds = [f for f in feeds if str(f.get("slug") or "") == str(args.only)]
        if not feeds:
            print(f"No feed found matching --only={args.only}", file=sys.stderr)
            return 1

    if args.sanitize_cache:
        # No network. Rewrite cached markdown by re-sanitizing existing tags.
        changed = False
        for feed_cfg in feeds:
            slug = str(feed_cfg.get("slug") or "")
            md_path = feeds_md_dir / f"{slug}.md"
            feed_json = _load_existing_feed_json(md_path)
            if not feed_json:
                _log(f"[skip] {slug} (no cache file)", quiet=args.quiet)
                continue

            prev_sig = json.dumps(feed_json, sort_keys=True, ensure_ascii=False)
            for ep in feed_json.get("episodes") or []:
                ep["speakers"] = sanitize_speakers(ep.get("speakers"))
                ep["topics"] = sanitize_topics(ep.get("topics"))
            next_sig = json.dumps(feed_json, sort_keys=True, ensure_ascii=False)
            if prev_sig == next_sig:
                _log(f"[no-op] {slug} (already sanitized)", quiet=args.quiet)
                continue

            per_feed_state = state["feeds"].get(slug, {})
            md = _render_cache_markdown(
                feed_slug=slug,
                fetched_at=str(feed_json.get("fetched_at") or now_iso),
                etag=per_feed_state.get("etag"),
                last_modified=per_feed_state.get("last_modified"),
                feed=feed_json,
                defaults=defaults,
            )
            feeds_md_dir.mkdir(parents=True, exist_ok=True)
            md_path.write_text(md, encoding="utf-8")
            changed = True
            _log(f"[sanitized] {slug} -> {md_path}", quiet=args.quiet)

        state["updated_at"] = now_iso
        write_json(state_path, state)
        if changed:
            _log("[done] cache sanitized", quiet=args.quiet)
            return 0
        _log("[done] no cache changes", quiet=args.quiet)
        return 0

    jobs: list[_FeedJob] = []
    per_feed_state_by_slug: dict[str, dict] = {}

    for feed_cfg in feeds:
        slug = feed_cfg.get("slug")
        url = feed_cfg.get("url")
        if not slug or not url:
            print(f"Skipping invalid feed config: {feed_cfg}", file=sys.stderr)
            continue

        feed_min_hours = int(feed_cfg.get("min_hours_between_checks", min_hours_between_checks))
        feed_max_episodes = int(feed_cfg.get("max_episodes_per_feed", max_episodes_per_feed))

        per_feed_state = state["feeds"].get(slug, {})
        last_checked = per_feed_state.get("last_checked_at")

        # If state is missing but cache exists, infer last-checked so manual runs don't refetch.
        if not per_feed_state.get("last_checked_unix"):
            inferred = _infer_last_checked_unix_from_cache(feeds_md_dir / f"{slug}.md")
            if inferred:
                per_feed_state.setdefault("last_checked_unix", inferred)
                per_feed_state.setdefault("last_checked_at", datetime.fromtimestamp(inferred, tz=timezone.utc).isoformat())
                last_checked = per_feed_state.get("last_checked_at")

        # Cooldown check.
        if (not args.force) and last_checked:
            try:
                last_ts = int(per_feed_state.get("last_checked_unix", 0))
                age_seconds = max(0, int(time.time()) - last_ts)
                if age_seconds < feed_min_hours * 3600:
                    _log(f"[skip] {slug} (cooldown)", quiet=args.quiet)
                    state["feeds"][slug] = per_feed_state
                    continue
            except Exception:
                pass

        _log(f"[queue] {slug} {url}", quiet=args.quiet)
        jobs.append(
            _FeedJob(
                slug=str(slug),
                url=str(url),
                feed_title=feed_cfg.get("title_override"),
                feed_min_hours=feed_min_hours,
                feed_max_episodes=feed_max_episodes,
            )
        )
        per_feed_state_by_slug[str(slug)] = per_feed_state

    if jobs:
        max_workers = max(1, min(int(args.concurrency), len(jobs)))
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = {}
            for job in jobs:
                futures[
                    ex.submit(
                        _process_one_feed,
                        job,
                        feeds_md_dir=feeds_md_dir,
                        defaults=defaults,
                        timeout_seconds=timeout_seconds,
                        user_agent=user_agent,
                        quiet=args.quiet,
                        per_feed_state=per_feed_state_by_slug[job.slug],
                        now_iso=now_iso,
                    )
                ] = job.slug

            for fut in as_completed(futures):
                slug = futures[fut]
                try:
                    res = fut.result()
                except Exception as e:
                    print(f"[error] {slug} failed during processing: {e}", file=sys.stderr)
                    continue

                state["feeds"][res.slug] = res.per_feed_state
                if res.changed:
                    any_changed = True

    state["updated_at"] = now_iso
    write_json(state_path, state)

    if any_changed:
        _log("[done] feeds updated", quiet=args.quiet)
    else:
        _log("[done] no feed changes", quiet=args.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
