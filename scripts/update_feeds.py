from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
import threading
import weakref

from scripts.shared import (
    REPO_ROOT,
    extract_speakers,
    extract_topics,
    format_bytes,
    fetch_url,
    parse_feed,
    path_stats,
    read_json,
    read_feeds_config,
    sanitize_speakers,
    sanitize_topics,
    stable_episode_key,
    utc_now_iso,
    write_json,
)

_DISABLE_AFTER_CONSECUTIVE_FAILURES_DEFAULT = 3
_DISABLE_IMMEDIATELY_HTTP_STATUSES = {410}

try:
    from concurrent.futures.thread import _threads_queues, _worker  # type: ignore
except Exception:  # pragma: no cover
    _threads_queues = None
    _worker = None


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch RSS/Atom feeds and update cache markdown.")
    p.add_argument(
        "--feeds",
        default="feeds.md",
        help="Path to feeds config Markdown (.md; contains 'site' + 'defaults' + 'feeds').",
    )
    p.add_argument("--cache", default="cache", help="Cache directory.")
    p.add_argument("--force", action="store_true", help="Ignore cooldown and refetch all feeds.")
    p.add_argument(
        "--concurrency",
        type=int,
        default=3,
        help="Number of feeds to fetch concurrently (default: 3).",
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


def _normalize_youtube_url(url: str) -> tuple[str, str | None]:
    """
    Accept either YouTube Atom feed URLs (preferred) or convenience channel/playlist URLs.

    Returns (normalized_url, note). `note` is non-null when we rewrote the input.
    """
    u = str(url or "").strip()
    if not u:
        return u, None
    try:
        parsed = urllib.parse.urlparse(u)
    except Exception:
        return u, None

    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in ("youtube.com", "m.youtube.com"):
        return u, None

    path = parsed.path or ""
    if path.startswith("/feeds/videos.xml"):
        return u, None

    q = urllib.parse.parse_qs(parsed.query or "")
    # Playlist URLs commonly have ?list=PL...
    if "list" in q and q["list"]:
        pid = str(q["list"][0] or "").strip()
        if pid:
            return f"https://www.youtube.com/feeds/videos.xml?playlist_id={urllib.parse.quote(pid)}", "playlist"

    # Channel URLs: /channel/UC...
    if path.startswith("/channel/"):
        cid = path.split("/", 3)[2] if len(path.split("/")) >= 3 else ""
        cid = cid.strip()
        if cid:
            return f"https://www.youtube.com/feeds/videos.xml?channel_id={urllib.parse.quote(cid)}", "channel"

    return u, None


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.tmp"
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


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


def _norm_name_list(value) -> list[str]:
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


def _norm_categories(value) -> list[str]:
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

def _merge_always_speakers(*, detected: list[str], always: list[str], limit: int = 12) -> list[str]:
    base = sanitize_speakers(detected)
    always_clean = sanitize_speakers(always)
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


def _filter_excluded_speakers(*, speakers: list[str], exclude: list[str]) -> list[str]:
    """
    Remove excluded names from an already-sanitized speaker list.
    Matches case-insensitively and also treats `exclude` as a prefix match
    (e.g. "King Charles" excludes "King Charles III").
    """
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
        # Prefix-match for common suffix variants (e.g. "Jr", "III").
        if any(s_norm.startswith(x + " ") for x in ex_norm):
            continue
        out.append(s)
    return out


def _render_cache_markdown(
    *,
    feed_slug: str,
    fetched_at: str,
    checked_at: str,
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
    lines.append(f"- checked_at: `{checked_at}`")
    if etag:
        lines.append(f"- etag: `{etag}`")
    if last_modified:
        lines.append(f"- last_modified: `{last_modified}`")
    lines.append(f"- max_episodes_per_feed: `{defaults.get('max_episodes_per_feed')}`")
    fetch = feed.get("fetch") if isinstance(feed, dict) else None
    if isinstance(fetch, dict):
        status = str(fetch.get("status") or "").strip()
        if status and status != "ok":
            lines.append(f"- status: `{status}`")
            warn = fetch.get("warning")
            if isinstance(warn, dict):
                msg = str(warn.get("message") or "").strip()
                if msg:
                    lines.append(f"- warning: {msg}")
            err = fetch.get("error")
            if isinstance(err, dict):
                code = err.get("status")
                msg = str(err.get("message") or "").strip()
                if isinstance(code, int) and code:
                    if msg:
                        lines.append(f"- last_error: `HTTP {code}` — {msg}")
                    else:
                        lines.append(f"- last_error: `HTTP {code}`")
                elif msg:
                    lines.append(f"- last_error: {msg}")
            disabled_reason = str(fetch.get("disabled_reason") or "").strip()
            if disabled_reason:
                lines.append(f"- disabled_reason: {disabled_reason}")
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


_SPACY_LOCK = Lock()
_SPACY_NLP = None


def _get_spacy_nlp(*, quiet: bool):
    global _SPACY_NLP
    if _SPACY_NLP is not None:
        return _SPACY_NLP
    with _SPACY_LOCK:
        if _SPACY_NLP is not None:
            return _SPACY_NLP
        try:
            import spacy  # type: ignore
        except Exception:
            raise RuntimeError(
                "spaCy is not installed.\n"
                "Fix:\n"
                "  (recommended) create a venv (avoids PEP 668 'externally-managed-environment'):\n"
                "    python3 -m venv .venv\n"
                "    . .venv/bin/activate\n"
                "    python -m pip install -r requirements.txt\n"
                "    python -m spacy download en_core_web_sm\n"
                "\n"
                "  Then run scripts using that venv:\n"
                "    .venv/bin/python -m scripts.update_feeds ...\n"
            )

        try:
            _SPACY_NLP = spacy.load("en_core_web_sm", disable=["parser"])
            return _SPACY_NLP
        except Exception as e:
            raise RuntimeError(
                "spaCy model en_core_web_sm is not available.\n"
                "Fix:\n"
                "  python3 -m spacy download en_core_web_sm\n"
                "If you already ran that, ensure you're using the same Python environment.\n"
                f"Underlying error: {e}\n"
            )


def _try_tag_with_spacy(items: list[dict], *, quiet: bool) -> dict[str, dict]:
    """
    Uses spaCy NER/POS (if installed) to extract speakers/topics.
    Returns a dict: episode_key -> {speakers: [...], topics: [...]}.
    """
    nlp = _get_spacy_nlp(quiet=quiet)

    ids: list[str] = []
    texts: list[str] = []
    titles: list[str] = []
    for item in items:
        eid = str(item.get("id") or "")
        title = str(item.get("title") or "")
        desc = str(item.get("description") or "")
        if not eid:
            continue
        ids.append(eid)
        titles.append(title)
        # Keep full description, but cap to avoid pathological feeds.
        combined = f"{title}\n{desc}"
        texts.append(combined[:8000])

    out: dict[str, dict] = {}

    with _SPACY_LOCK:
        docs = list(nlp.pipe(texts, batch_size=24))
        title_docs = list(nlp.pipe(titles, batch_size=48))

    for eid, doc, tdoc in zip(ids, docs, title_docs, strict=False):
        speakers = []
        for ent in getattr(doc, "ents", ()):
            if getattr(ent, "label_", None) == "PERSON":
                speakers.append(ent.text)

        topics = []
        for tok in tdoc:
            pos = getattr(tok, "pos_", "")
            if pos not in ("NOUN", "PROPN"):
                continue
            if getattr(tok, "is_stop", False):
                continue
            if not getattr(tok, "is_alpha", False):
                continue
            lemma = (getattr(tok, "lemma_", "") or tok.text or "").lower()
            if not lemma or lemma == "-pron-":
                continue
            topics.append(lemma)

        out[eid] = {"speakers": speakers, "topics": topics}
    return out


@dataclass(frozen=True)
class _FeedJob:
    slug: str
    url: str
    feed_title: str | None
    feed_min_hours: int
    feed_max_episodes: int
    owners: list[str]
    common_speakers: list[str]
    exclude_speakers: list[str]
    categories: list[str]


@dataclass
class _FeedResult:
    slug: str
    per_feed_state: dict
    changed: bool
    wrote_cache: bool


def _http_error_info(e: BaseException) -> tuple[int | None, str]:
    if isinstance(e, urllib.error.HTTPError):
        try:
            code = int(getattr(e, "code", None) or 0) or None
        except Exception:
            code = None
        msg = str(getattr(e, "reason", "") or "").strip()
        if not msg:
            msg = str(e).strip()
        return code, msg
    msg = str(e).strip() or e.__class__.__name__
    return None, msg


def _should_disable_feed(*, status: int | None, consecutive_failures: int, disable_after: int) -> tuple[bool, str]:
    if isinstance(status, int) and status in _DISABLE_IMMEDIATELY_HTTP_STATUSES:
        return True, f"HTTP {status}"
    if consecutive_failures >= max(1, int(disable_after)):
        return True, f"{consecutive_failures} consecutive failures"
    return False, ""


def _write_cache_if_changed(
    *,
    md_path: Path,
    feed_slug: str,
    checked_at: str,
    per_feed_state: dict,
    defaults: dict,
    feed_json: dict,
    prev_json: dict,
    quiet: bool,
) -> bool:
    prev_sig = json.dumps(prev_json or {}, sort_keys=True, ensure_ascii=False)
    next_sig = json.dumps(feed_json or {}, sort_keys=True, ensure_ascii=False)
    if prev_sig == next_sig:
        return False

    md_path.parent.mkdir(parents=True, exist_ok=True)
    fetched_at = str(feed_json.get("fetched_at") or "—")
    md = _render_cache_markdown(
        feed_slug=feed_slug,
        fetched_at=fetched_at,
        checked_at=checked_at,
        etag=per_feed_state.get("etag"),
        last_modified=per_feed_state.get("last_modified"),
        feed=feed_json,
        defaults=defaults,
    )
    _atomic_write_text(md_path, md)
    if not quiet:
        print(f"[cached] {feed_slug} -> {md_path}")
    return True


class _DaemonThreadPoolExecutor(ThreadPoolExecutor):
    """
    A ThreadPoolExecutor variant that uses daemon threads.

    This makes Ctrl+C behave sensibly for long-running network requests: the
    process can terminate without waiting for in-flight fetches to finish.
    """

    def _adjust_thread_count(self):  # pragma: no cover
        # Copy of stdlib behavior with `daemon=True`.
        if self._idle_semaphore.acquire(timeout=0):
            return

        if _worker is None or _threads_queues is None:
            return super()._adjust_thread_count()

        def weakref_cb(_, q=self._work_queue):
            q.put(None)

        num_threads = len(self._threads)
        if num_threads < self._max_workers:
            thread_name = "%s_%d" % (self._thread_name_prefix or self, num_threads)
            t = threading.Thread(
                name=thread_name,
                target=_worker,
                args=(weakref.ref(self, weakref_cb), self._work_queue, self._initializer, self._initargs),
                daemon=True,
            )
            t.start()
            self._threads.add(t)
            _threads_queues[t] = self._work_queue


def _record_failure(
    *,
    feed_slug: str,
    url: str,
    job: _FeedJob,
    prev_json: dict,
    per_feed_state: dict,
    defaults: dict,
    now_iso: str,
    status: int | None,
    message: str,
    disable_after: int,
    quiet: bool,
    md_path: Path,
) -> bool:
    prev_fetch = prev_json.get("fetch") if isinstance(prev_json, dict) else None
    prev_status = str(prev_fetch.get("status") or "").strip() if isinstance(prev_fetch, dict) else ""
    prev_err = prev_fetch.get("error") if isinstance(prev_fetch, dict) else None
    prev_err_sig = ""
    if isinstance(prev_err, dict):
        prev_err_sig = f"{prev_err.get('status')}|{prev_err.get('message')}"

    consecutive = int(per_feed_state.get("consecutive_failures", 0) or 0) + 1
    per_feed_state["consecutive_failures"] = consecutive
    per_feed_state["last_error_at"] = now_iso
    per_feed_state["last_error_status"] = status
    per_feed_state["last_error_message"] = message

    disable, disable_reason = _should_disable_feed(
        status=status, consecutive_failures=consecutive, disable_after=disable_after
    )
    became_disabled = False
    if disable and not per_feed_state.get("disabled"):
        per_feed_state["disabled"] = True
        per_feed_state["disabled_at"] = now_iso
        per_feed_state["disabled_url"] = url
        per_feed_state["disabled_reason"] = disable_reason or "repeated failures"
        became_disabled = True

    next_status = "disabled" if per_feed_state.get("disabled") else "error"
    next_err_sig = f"{status}|{message}"
    should_write = False
    if prev_status != next_status:
        should_write = True
    elif prev_err_sig != next_err_sig and next_err_sig.strip("|"):
        should_write = True
    elif became_disabled:
        should_write = True

    if not should_write:
        return False

    base = dict(prev_json) if isinstance(prev_json, dict) else {}
    base.setdefault("version", 1)
    base["slug"] = feed_slug
    base["source_url"] = url
    base["title"] = str(base.get("title") or job.feed_title or feed_slug)
    base["description"] = str(base.get("description") or "")
    if not isinstance(base.get("episodes"), list):
        base["episodes"] = []
    base["owners"] = sanitize_speakers(job.owners)
    base["common_speakers"] = sanitize_speakers(job.common_speakers)
    base["categories"] = list(job.categories or [])

    fetch = dict(base.get("fetch") or {}) if isinstance(base.get("fetch"), dict) else {}
    if prev_status not in ("error", "disabled"):
        fetch.setdefault("error_since", now_iso)
    fetch["status"] = next_status
    fetch["checked_at"] = now_iso
    fetch["consecutive_failures"] = consecutive
    fetch["error"] = {"status": status, "message": message}
    if per_feed_state.get("disabled"):
        fetch["disabled"] = True
        fetch["disabled_at"] = per_feed_state.get("disabled_at")
        fetch["disabled_reason"] = per_feed_state.get("disabled_reason")
    base["fetch"] = fetch

    return _write_cache_if_changed(
        md_path=md_path,
        feed_slug=feed_slug,
        checked_at=now_iso,
        per_feed_state=per_feed_state,
        defaults=defaults,
        feed_json=base,
        prev_json=prev_json,
        quiet=quiet,
    )


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
    disable_after = int(
        defaults.get("disable_after_consecutive_failures", _DISABLE_AFTER_CONSECUTIVE_FAILURES_DEFAULT)
    )

    try:
        result = fetch_url(
            url,
            timeout_seconds=timeout_seconds,
            user_agent=user_agent,
            if_none_match=etag,
            if_modified_since=last_modified,
        )
    except Exception as e:
        status, msg = _http_error_info(e)
        _err(f"[error] {slug} fetch failed: {msg}")
        per_feed_state["last_checked_at"] = now_iso
        per_feed_state["last_checked_unix"] = int(time.time())
        wrote = _record_failure(
            feed_slug=slug,
            url=url,
            job=job,
            prev_json=prev_json,
            per_feed_state=per_feed_state,
            defaults=defaults,
            now_iso=now_iso,
            status=status,
            message=msg,
            disable_after=disable_after,
            quiet=quiet,
            md_path=md_path,
        )
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=wrote, wrote_cache=wrote)

    per_feed_state["last_checked_at"] = now_iso
    per_feed_state["last_checked_unix"] = int(time.time())

    if result.status == 304:
        if not quiet:
            print(f"[unchanged] {slug}")
        # Treat 304 as a successful check: clear any recorded failure/disabled state.
        if per_feed_state.get("consecutive_failures") or per_feed_state.get("disabled"):
            per_feed_state["consecutive_failures"] = 0
            per_feed_state.pop("disabled", None)
            per_feed_state.pop("disabled_at", None)
            per_feed_state.pop("disabled_url", None)
            per_feed_state.pop("disabled_reason", None)
            per_feed_state.pop("last_error_at", None)
            per_feed_state.pop("last_error_status", None)
            per_feed_state.pop("last_error_message", None)

        prev_fetch = prev_json.get("fetch") if isinstance(prev_json, dict) else None
        if isinstance(prev_fetch, dict) and str(prev_fetch.get("status") or "").strip() in ("error", "disabled"):
            cleared = dict(prev_json)
            cleared.pop("fetch", None)
            wrote = _write_cache_if_changed(
                md_path=md_path,
                feed_slug=slug,
                checked_at=now_iso,
                per_feed_state=per_feed_state,
                defaults=defaults,
                feed_json=cleared,
                prev_json=prev_json,
                quiet=quiet,
            )
            return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=wrote, wrote_cache=wrote)

        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=False, wrote_cache=False)

    if not result.content:
        if not quiet:
            print(f"[warn] {slug} empty response")
        status = int(result.status) if isinstance(result.status, int) else None
        wrote = _record_failure(
            feed_slug=slug,
            url=url,
            job=job,
            prev_json=prev_json,
            per_feed_state=per_feed_state,
            defaults=defaults,
            now_iso=now_iso,
            status=status,
            message="Empty response body",
            disable_after=disable_after,
            quiet=quiet,
            md_path=md_path,
        )
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=wrote, wrote_cache=wrote)

    try:
        parsed = parse_feed(result.content, source_url=url)
    except Exception as e:
        msg = str(e).strip() or "Parse error"
        _err(f"[error] {slug} parse failed: {msg}")
        wrote = _record_failure(
            feed_slug=slug,
            url=url,
            job=job,
            prev_json=prev_json,
            per_feed_state=per_feed_state,
            defaults=defaults,
            now_iso=now_iso,
            status=None,
            message=msg,
            disable_after=disable_after,
            quiet=quiet,
            md_path=md_path,
        )
        return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=wrote, wrote_cache=wrote)

    feed_title = job.feed_title or parsed.get("title") or slug
    episodes_raw = parsed.get("items", [])
    parse_warnings = parsed.get("parse_warnings") if isinstance(parsed, dict) else None

    pre = []
    for item in episodes_raw[: job.feed_max_episodes * 2]:
        title = item.get("title") or ""
        published_at = item.get("published_at")
        description = item.get("description") or ""
        enclosure_url = item.get("enclosure_url")
        image_url = item.get("image_url")
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
                "image_url": image_url,
                "enclosure_url": enclosure_url,
                "enclosure_type": item.get("enclosure_type"),
                "enclosure_length": item.get("enclosure_length"),
                "itunes_duration": item.get("itunes_duration"),
            }
        )

    spacy_items = [{"id": ep["key"], "title": ep["title"], "description": ep["description"]} for ep in pre]
    spacy_tags = _try_tag_with_spacy(spacy_items, quiet=quiet)

    episodes = []
    always_speakers = (job.common_speakers or []) + (job.owners or [])
    for ep in pre:
        key = ep["key"]
        title = ep["title"]
        description = ep["description"]
        combined_text = f"{title}\n{description}"

        tags = (spacy_tags or {}).get(key) if spacy_tags else None
        speakers = tags.get("speakers") if isinstance(tags, dict) else None
        topics = tags.get("topics") if isinstance(tags, dict) else None
        if not isinstance(speakers, list) or not speakers:
            speakers = extract_speakers(combined_text)
        if not isinstance(topics, list) or not topics:
            topics = extract_topics(title)

        episodes.append(
            {
                **ep,
                "speakers": _filter_excluded_speakers(
                    speakers=_merge_always_speakers(detected=speakers, always=always_speakers, limit=12),
                    exclude=(job.exclude_speakers or []),
                ),
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
        "owners": sanitize_speakers(job.owners),
        "common_speakers": sanitize_speakers(job.common_speakers),
        "categories": list(job.categories or []),
        "episodes": episodes,
    }

    if isinstance(parse_warnings, list) and parse_warnings:
        # Surface parsing issues without failing the update. (These feeds still tend to work.)
        msg = str(parse_warnings[0] or "").strip() or "Feed parsed with warnings"
        if len(msg) > 240:
            msg = msg[:240].rstrip() + "…"
        feed_json["fetch"] = {
            "status": "warning",
            "checked_at": now_iso,
            "warning": {"message": msg},
        }

    # Clear failure/disabled state on success.
    if per_feed_state.get("consecutive_failures") or per_feed_state.get("disabled"):
        per_feed_state["consecutive_failures"] = 0
        per_feed_state.pop("disabled", None)
        per_feed_state.pop("disabled_at", None)
        per_feed_state.pop("disabled_url", None)
        per_feed_state.pop("disabled_reason", None)
        per_feed_state.pop("last_error_at", None)
        per_feed_state.pop("last_error_status", None)
        per_feed_state.pop("last_error_message", None)

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
        checked_at=now_iso,
        etag=per_feed_state.get("etag"),
        last_modified=per_feed_state.get("last_modified"),
        feed=feed_json,
        defaults=defaults,
    )
    _atomic_write_text(md_path, md)
    if not quiet:
        print(f"[updated] {slug} -> {md_path}")
    return _FeedResult(slug=slug, per_feed_state=per_feed_state, changed=True, wrote_cache=True)


def main() -> int:
    args = _parse_args()
    feeds_path = REPO_ROOT / args.feeds
    cache_dir = REPO_ROOT / args.cache
    state_path = cache_dir / "state.json"
    feeds_md_dir = cache_dir / "feeds"

    try:
        cfg = read_feeds_config(feeds_path)
    except Exception as e:
        print("[error] Failed to parse feeds config.", file=sys.stderr)
        print(f"Path: {feeds_path}", file=sys.stderr)
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
    defaults = cfg.get("defaults", {})
    min_hours_between_checks = int(defaults.get("min_hours_between_checks", 6))
    max_episodes_per_feed = int(defaults.get("max_episodes_per_feed", 200))
    timeout_seconds = int(defaults.get("request_timeout_seconds", 25))
    user_agent = str(defaults.get("user_agent", "actual-plays-static-podcast-index/1.0"))

    state = read_json(state_path) if state_path.exists() else {}
    state.setdefault("feeds", {})

    any_changed = False
    had_error = False
    now_iso = utc_now_iso()

    feeds = cfg.get("feeds") or []
    if not feeds:
        print(f"[warn] No feeds configured in {args.feeds} (nothing to update).", file=sys.stderr)
        return 0

    if args.only:
        feeds = [f for f in feeds if str(f.get("slug") or "") == str(args.only)]
        if not feeds:
            print(f"No feed found matching --only={args.only}", file=sys.stderr)
            return 1

    if args.sanitize_cache:
        # No network. Rewrite cached markdown by re-sanitizing existing tags.
        changed = False
        site_cfg = cfg.get("site") if isinstance(cfg.get("site"), dict) else {}
        site_exclude = _norm_name_list(site_cfg.get("exclude_speakers") or site_cfg.get("excludeSpeakers"))
        for feed_cfg in feeds:
            slug = str(feed_cfg.get("slug") or "")
            owners = _norm_name_list(feed_cfg.get("owners") or feed_cfg.get("owner"))
            common_speakers = _norm_name_list(feed_cfg.get("common_speakers") or feed_cfg.get("commonSpeakers"))
            exclude_speakers = _norm_name_list(feed_cfg.get("exclude_speakers") or feed_cfg.get("excludeSpeakers"))
            exclude = [x for x in [str(v or "").strip() for v in (site_exclude + exclude_speakers)] if x]
            categories = _norm_categories(feed_cfg.get("categories") or feed_cfg.get("category"))
            md_path = feeds_md_dir / f"{slug}.md"
            feed_json = _load_existing_feed_json(md_path)
            if not feed_json:
                _log(f"[skip] {slug} (no cache file)", quiet=args.quiet)
                continue

            prev_sig = json.dumps(feed_json, sort_keys=True, ensure_ascii=False)
            always = common_speakers + owners
            for ep in feed_json.get("episodes") or []:
                ep["speakers"] = _filter_excluded_speakers(
                    speakers=_merge_always_speakers(detected=ep.get("speakers") or [], always=always, limit=12),
                    exclude=exclude,
                )
                ep["topics"] = sanitize_topics(ep.get("topics"))
            feed_json["owners"] = sanitize_speakers(owners)
            feed_json["common_speakers"] = sanitize_speakers(common_speakers)
            feed_json["categories"] = categories
            next_sig = json.dumps(feed_json, sort_keys=True, ensure_ascii=False)
            if prev_sig == next_sig:
                _log(f"[no-op] {slug} (already sanitized)", quiet=args.quiet)
                continue

            per_feed_state = state["feeds"].get(slug, {})
            md = _render_cache_markdown(
                feed_slug=slug,
                fetched_at=str(feed_json.get("fetched_at") or now_iso),
                checked_at=str(
                    (feed_json.get("fetch") or {}).get("checked_at") if isinstance(feed_json.get("fetch"), dict) else ""
                )
                or str(feed_json.get("fetched_at") or now_iso),
                etag=per_feed_state.get("etag"),
                last_modified=per_feed_state.get("last_modified"),
                feed=feed_json,
                defaults=defaults,
            )
            feeds_md_dir.mkdir(parents=True, exist_ok=True)
            _atomic_write_text(md_path, md)
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

    site_cfg = cfg.get("site") if isinstance(cfg.get("site"), dict) else {}
    site_exclude = _norm_name_list(site_cfg.get("exclude_speakers") or site_cfg.get("excludeSpeakers"))

    for feed_cfg in feeds:
        slug = feed_cfg.get("slug")
        url = feed_cfg.get("url")
        if not slug or not url:
            print(f"Skipping invalid feed config: {feed_cfg}", file=sys.stderr)
            continue
        norm_url, yt_note = _normalize_youtube_url(str(url))
        if yt_note:
            _log(f"[info] {slug} YouTube URL -> feed ({yt_note})", quiet=args.quiet)
            url = norm_url

        feed_min_hours = int(feed_cfg.get("min_hours_between_checks", min_hours_between_checks))
        feed_max_episodes = int(feed_cfg.get("max_episodes_per_feed", max_episodes_per_feed))

        per_feed_state = state["feeds"].get(slug, {})
        if per_feed_state.get("disabled"):
            disabled_url = str(per_feed_state.get("disabled_url") or "")
            if disabled_url and disabled_url != str(url):
                # URL changed in config: allow the feed to retry.
                per_feed_state.pop("disabled", None)
                per_feed_state.pop("disabled_at", None)
                per_feed_state.pop("disabled_url", None)
                per_feed_state.pop("disabled_reason", None)
                per_feed_state["consecutive_failures"] = 0
                per_feed_state.pop("last_error_at", None)
                per_feed_state.pop("last_error_status", None)
                per_feed_state.pop("last_error_message", None)
            else:
                _log(f"[skip] {slug} (disabled)", quiet=args.quiet)
                state["feeds"][slug] = per_feed_state
                continue
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
        owners = _norm_name_list(feed_cfg.get("owners") or feed_cfg.get("owner"))
        common_speakers = _norm_name_list(feed_cfg.get("common_speakers") or feed_cfg.get("commonSpeakers"))
        exclude_speakers = _norm_name_list(feed_cfg.get("exclude_speakers") or feed_cfg.get("excludeSpeakers"))
        categories = _norm_categories(feed_cfg.get("categories") or feed_cfg.get("category"))
        jobs.append(
            _FeedJob(
                slug=str(slug),
                url=str(url),
                feed_title=feed_cfg.get("title_override"),
                feed_min_hours=feed_min_hours,
                feed_max_episodes=feed_max_episodes,
                owners=sanitize_speakers(owners),
                common_speakers=sanitize_speakers(common_speakers),
                exclude_speakers=[x for x in [str(v or "").strip() for v in (site_exclude + exclude_speakers)] if x],
                categories=categories,
            )
        )
        per_feed_state_by_slug[str(slug)] = per_feed_state

    if jobs:
        try:
            _get_spacy_nlp(quiet=args.quiet)
        except Exception as e:
            print("[error] spaCy tagging is required but unavailable.", file=sys.stderr)
            print(str(e), file=sys.stderr)
            return 2

        max_workers = max(1, min(int(args.concurrency), len(jobs)))
        ex = _DaemonThreadPoolExecutor(max_workers=max_workers)
        interrupted = False
        try:
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
                    had_error = True
                    continue

                state["feeds"][res.slug] = res.per_feed_state
                if res.changed:
                    any_changed = True
        except KeyboardInterrupt:
            interrupted = True
            print("\n[interrupt] Ctrl+C received; stopping.", file=sys.stderr)
            had_error = True
            return 130
        finally:
            try:
                ex.shutdown(wait=not interrupted, cancel_futures=interrupted)
            except Exception:
                pass

    state["updated_at"] = now_iso
    write_json(state_path, state)

    if not args.quiet:
        feeds_stats = path_stats(feeds_md_dir)
        state_stats = path_stats(state_path)
        cache_stats = path_stats(cache_dir)
        print(
            "[size] cache/feeds: "
            f"{feeds_stats['files']} files, {format_bytes(feeds_stats['bytes'])} · "
            f"state.json: {format_bytes(state_stats['bytes'])} · "
            f"cache total: {format_bytes(cache_stats['bytes'])}"
        )

    if any_changed:
        _log("[done] feeds updated", quiet=args.quiet)
    else:
        _log("[done] no feed changes", quiet=args.quiet)
    return 2 if had_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
