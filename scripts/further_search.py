"""
Further-search integration: run pod-api-speaker-search.js with batched names,
persist results, and merge external episodes into per-speaker feeds.

Uses rotation to distribute API queries across builds (e.g. 10 names per run
when there are 100+ names) to avoid exhausting usage limits.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.shared import REPO_ROOT, slugify

_STATE_FILENAME = "further-search-state.json"
_EPISODES_FILENAME = "speaker-search-episodes.json"
_DEFAULT_BATCH_SIZE = 10
_MAX_EPISODES_PER_SPEAKER = 2000


def _norm_url(value: str | None) -> str:
    s = str(value or "").strip()
    if not s:
        return ""
    return s.rstrip("/")


def _load_state(cache_dir: Path) -> dict[str, Any]:
    path = cache_dir / _STATE_FILENAME
    if not path.exists():
        return {"next_index": 0, "batch_size": _DEFAULT_BATCH_SIZE}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {"next_index": 0, "batch_size": _DEFAULT_BATCH_SIZE}


def _save_state(cache_dir: Path, state: dict[str, Any]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / _STATE_FILENAME
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

def further_search_cache_stats(cache_dir: Path) -> dict[str, int]:
    by_speaker = _load_episodes_cache(cache_dir)
    speakers = len(by_speaker)
    episodes = 0
    for v in by_speaker.values():
        if isinstance(v, list):
            episodes += len(v)
    return {"speakers": speakers, "episodes": episodes}

def further_search_state(cache_dir: Path) -> dict[str, Any]:
    return _load_state(cache_dir)


def _load_episodes_cache(cache_dir: Path) -> dict[str, list[dict[str, Any]]]:
    path = cache_dir / _EPISODES_FILENAME
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        by_speaker = data.get("by_speaker")
        if not isinstance(by_speaker, dict):
            return {}
        return {k: v if isinstance(v, list) else [] for k, v in by_speaker.items()}
    except Exception:
        return {}

def _normalize_cached_entry(e: dict[str, Any]) -> dict[str, Any]:
    """
    Best-effort migration for older cached entries:
    - ensure episode_key/dedupe_key are sha1 strings
    - regroup external feed_slug by podcast identity when possible
    """
    out = dict(e or {})
    # Ensure source_rss_url is normalized.
    if out.get("source_rss_url"):
        out["source_rss_url"] = _norm_url(out.get("source_rss_url"))

    # Ensure dedupe_key/episode_key are sha1.
    dedupe = str(out.get("dedupe_key") or "").strip()
    epk = str(out.get("episode_key") or "").strip()
    if not dedupe:
        stable = epk or str(out.get("audio_url") or out.get("link_url") or "")
        dedupe = _episode_key_hash(stable)
        out["dedupe_key"] = dedupe
    if not epk or len(epk) != 40 or any(ch in epk for ch in "/:?&="):
        out["episode_key"] = dedupe

    # Regroup external feed_slug to be per-podcast (not per-episode).
    feed_slug = str(out.get("feed_slug") or "").strip()
    if feed_slug.startswith("external:"):
        parts = feed_slug.split(":", 2)
        provider = parts[1] if len(parts) >= 2 else "external"
        podcast_key = ""
        rss = _norm_url(out.get("source_rss_url"))
        if rss:
            podcast_key = f"rss:{rss}"
        else:
            title = str(out.get("feed_title") or "").strip().lower()
            if title:
                podcast_key = f"title:{title}"
        if podcast_key:
            out["feed_slug"] = f"external:{provider}:{hashlib.sha1(podcast_key.encode()).hexdigest()[:12]}"
    return out


def _save_episodes_cache(cache_dir: Path, by_speaker: dict[str, list[dict[str, Any]]]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / _EPISODES_FILENAME
    path.write_text(
        json.dumps({"by_speaker": by_speaker}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _episode_stable_key(ep: dict[str, Any]) -> str:
    """
    Produce a stable key for an external episode, suitable for cross-provider
    de-duping when multiple sources find the same audio.
    """
    uid = (
        ep.get("audioUrl")
        or ep.get("episodeUrl")
        or ""
    )
    if uid:
        return str(uid)
    ids = ep.get("ids") or {}
    if ids.get("appleTrackId"):
        return f"apple:{ids['appleTrackId']}"
    if ids.get("podcastIndexEpisodeId"):
        return f"pi:{ids['podcastIndexEpisodeId']}"
    if ids.get("listennotesId"):
        return f"ln:{ids['listennotesId']}"
    if ids.get("podchaserId"):
        return f"pc:{ids['podchaserId']}"
    title = ep.get("title") or ""
    podcast = ep.get("podcastTitle") or ""
    date = ep.get("publishedAt") or ""
    h = hashlib.sha1(f"{title}|{podcast}|{date}".encode("utf-8")).hexdigest()
    return f"hash:{h}"

def _episode_key_hash(stable_key: str) -> str:
    return hashlib.sha1(str(stable_key or "").encode("utf-8")).hexdigest()

def _podcast_group_key(ep: dict[str, Any]) -> str:
    """
    Stable per-podcast grouping key, so speaker pages group remote episodes by show.
    Prefer RSS URL, fallback to podcast title.
    """
    rss = _norm_url(ep.get("rssFeedUrl"))
    if rss:
        return f"rss:{rss}"
    title = str(ep.get("podcastTitle") or "").strip().lower()
    if title:
        return f"title:{title}"
    return "unknown"

def _external_to_ep_entry(ep: dict[str, Any]) -> dict[str, Any]:
    """Convert speaker-search episode format to build_site ep_entry format."""
    provider = str(ep.get("provider") or "external").strip()
    stable_key = _episode_stable_key(ep)
    dedupe_key = _episode_key_hash(stable_key)
    podcast_key = _podcast_group_key(ep)
    feed_slug = f"external:{provider}:{hashlib.sha1(podcast_key.encode()).hexdigest()[:12]}"
    return {
        "feed_slug": feed_slug,
        "feed_title": str(ep.get("podcastTitle") or "").strip() or "Unknown",
        # Used to filter out episodes from feeds we already subscribe to.
        "source_rss_url": _norm_url(ep.get("rssFeedUrl")),
        "dedupe_key": dedupe_key,
        "episode_key": dedupe_key,
        "title": str(ep.get("title") or "").strip(),
        "published_at": ep.get("publishedAt"),
        "episode_image_url": None,
        "feed_image_url": None,
        "description": str(ep.get("description") or "").strip()[:320],
        "audio_url": str(ep.get("audioUrl") or "").strip() or None,
        "link_url": str(ep.get("episodeUrl") or "").strip() or None,
        "duration_seconds": None,
        "enclosure_bytes": None,
        "enclosure_type": None,
        "speakers": list(ep.get("matchedNames") or []),
        "topics": [],
        "external": True,
    }


def _dedupe_eps(
    eps: list[dict[str, Any]],
    *,
    local_audio_urls: set[str],
) -> list[dict[str, Any]]:
    """Dedupe external episodes; exclude local-audio duplicates."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for e in eps:
        audio = str(e.get("audio_url") or "").strip()
        if audio and audio in local_audio_urls:
            continue
        kid = str(e.get("dedupe_key") or e.get("episode_key") or "").strip() or audio
        if not kid:
            continue
        if kid in seen:
            continue
        seen.add(kid)
        out.append(e)
    return out


def run_further_search(
    *,
    cache_dir: Path,
    names: list[str],
    enabled: bool,
    batch_size: int | None = None,
    script_path: Path | None = None,
    quiet: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    """
    Run speaker search for a batch of names (when enabled), merge into cache,
    and return episodes grouped by speaker slug.

    When disabled or names empty, returns only cached data (if any).
    """
    if not enabled or not names:
        return _load_episodes_cache(cache_dir)

    names = [str(n).strip() for n in names if str(n).strip()]
    if not names:
        return _load_episodes_cache(cache_dir)

    batch_size = batch_size or _DEFAULT_BATCH_SIZE
    state = _load_state(cache_dir)
    next_index = int(state.get("next_index") or 0)
    state["batch_size"] = batch_size

    # Pick this run's batch (rotate through names).
    n = len(names)
    take = min(batch_size, n)
    batch: list[str] = []
    for i in range(take):
        idx = (next_index + i) % n
        batch.append(names[idx])
    next_index = (next_index + take) % n
    state["next_index"] = next_index
    state["last_batch"] = list(batch)
    state["last_run_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    state["last_status"] = "running"
    state.pop("last_error", None)

    script_path = script_path or (REPO_ROOT / "scripts" / "pod-api-speaker-search.js")
    if not script_path.exists():
        if not quiet:
            print("[further-search] script not found, skipping", file=sys.stderr)
        return _load_episodes_cache(cache_dir)

    out_path = cache_dir / ".further-search-batch.json"
    cache_dir.mkdir(parents=True, exist_ok=True)

    names_arg = ",".join(batch)
    env = {
        "CACHE_DIR": str(cache_dir / ".cache" / "podcast-search"),
        "CACHE_TTL_SECONDS": "86400",
    }

    try:
        if not quiet:
            print(f"[further-search] querying {len(batch)} names (batch {next_index - len(batch) % n}..{next_index})", file=sys.stderr)
        subprocess.run(
            [
                "node",
                str(script_path),
                "--names",
                names_arg,
                "--out",
                str(out_path),
            ],
            cwd=str(REPO_ROOT),
            env={**__import__("os").environ, **env},
            check=True,
            capture_output=quiet,
        )
    except Exception as e:
        # Don't fail the site build; keep cached data and surface why querying didn't happen.
        state["last_status"] = "error"
        state["last_error"] = str(e)
        print(f"[further-search] query failed: {e}", file=sys.stderr)
        _save_state(cache_dir, state)
        return _load_episodes_cache(cache_dir)

    state["last_status"] = "ok"
    _save_state(cache_dir, state)

    # Parse output and merge.
    if not out_path.exists():
        return _load_episodes_cache(cache_dir)

    try:
        data = json.loads(out_path.read_text(encoding="utf-8"))
    except Exception:
        return _load_episodes_cache(cache_dir)

    episodes_raw = data.get("episodes")
    if not isinstance(episodes_raw, list):
        return _load_episodes_cache(cache_dir)

    existing = _load_episodes_cache(cache_dir)

    for ep in episodes_raw:
        if not isinstance(ep, dict):
            continue
        matched = ep.get("matchedNames") or []
        converted = _external_to_ep_entry(ep)
        dedupe_key = str(converted.get("dedupe_key") or converted.get("episode_key") or "").strip()
        if not dedupe_key:
            continue
        for name in matched:
            sp_slug = slugify(str(name))
            if not sp_slug:
                continue
            lst = existing.setdefault(sp_slug, [])
            # Upgrade older cached entries that lack dedupe_key.
            for old in lst:
                if isinstance(old, dict) and not old.get("dedupe_key"):
                    ok = str(old.get("episode_key") or "").strip()
                    if ok and len(ok) == 40:  # already sha1
                        old["dedupe_key"] = ok
                        continue
                    stable = ok or str(old.get("audio_url") or old.get("link_url") or "")
                    old["dedupe_key"] = _episode_key_hash(stable)
                    old["episode_key"] = old["dedupe_key"]
            if any((str(e.get("dedupe_key") or e.get("episode_key") or "").strip() == dedupe_key for e in lst)):
                continue
            lst.append(converted)

    # Sort and cap per speaker.
    for sp_slug in list(existing.keys()):
        lst = existing[sp_slug]
        lst.sort(key=lambda e: (e.get("published_at") or ""), reverse=True)
        existing[sp_slug] = lst[:_MAX_EPISODES_PER_SPEAKER]

    _save_episodes_cache(cache_dir, existing)
    return existing


def get_external_episodes_for_speakers(
    cache_dir: Path,
    speaker_slugs: set[str],
    local_audio_urls: set[str],
) -> dict[str, list[dict[str, Any]]]:
    """
    Load cached external episodes for the given speaker slugs, deduped against
    local episodes (by audio_url). Returns {speaker_slug: [ep_entry, ...]}.
    """
    by_speaker = _load_episodes_cache(cache_dir)
    out: dict[str, list[dict[str, Any]]] = {}
    changed = False
    for sp_slug in speaker_slugs:
        raw = by_speaker.get(sp_slug) or []
        eps: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            norm = _normalize_cached_entry(item)
            if norm != item:
                changed = True
            eps.append(norm)
        deduped = _dedupe_eps(
            eps,
            local_audio_urls=local_audio_urls,
        )
        if deduped:
            out[sp_slug] = deduped

        # Persist normalized entries (keeps cache consistent across runs).
        by_speaker[sp_slug] = eps

    if changed:
        # Keep file bounded per speaker after migration.
        for sp in list(by_speaker.keys()):
            lst = by_speaker.get(sp) or []
            if not isinstance(lst, list):
                continue
            lst.sort(key=lambda e: (e.get("published_at") or ""), reverse=True)
            by_speaker[sp] = lst[:_MAX_EPISODES_PER_SPEAKER]
        _save_episodes_cache(cache_dir, by_speaker)
    return out
