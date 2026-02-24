#!/usr/bin/env python3
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path


# PodcastIndex auth: sha1(key+secret+unixTime) for Authorization header
PODCASTINDEX_KEY = os.getenv("PODCASTINDEX_KEY", "").strip() or "MJQTNTT48HSHGXC3ELBY"
PODCASTINDEX_SECRET = os.getenv("PODCASTINDEX_SECRET", "").strip() or "C7E4U5Qr5WwcAK6bSXmBymcBkDxZAF3#aKy^kRzA"

API_BASE = "https://api.podcastindex.org/api/1.0"

ROOT = Path(__file__).resolve().parents[2]
SOURCES_JSON = ROOT / "video-podcasts" / "video-sources.json"


def die(msg: str, code: int = 2) -> None:
    raise SystemExit(msg)


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"(^-|-$)", "", s)
    return s or "pi"


def norm_url(u: str) -> str:
    u = (u or "").strip()
    if not u:
        return ""
    try:
        p = urllib.parse.urlparse(u)
    except Exception:
        return u
    scheme = (p.scheme or "").lower()
    netloc = (p.netloc or "").lower()
    path = p.path or ""
    # don't drop query/fragment; some feeds are query-param keyed
    q = ("?" + p.query) if p.query else ""
    f = ("#" + p.fragment) if p.fragment else ""
    return urllib.parse.urlunparse((scheme, netloc, path, "", p.query, p.fragment)).strip()


def podcastindex_headers() -> dict:
    if not PODCASTINDEX_KEY or not PODCASTINDEX_SECRET:
        die("Missing PODCASTINDEX_KEY or PODCASTINDEX_SECRET (set env or edit the script).")
    ts = str(int(time.time()))
    auth = hashlib.sha1((PODCASTINDEX_KEY + PODCASTINDEX_SECRET + ts).encode("utf-8")).hexdigest()
    return {
        "User-Agent": "actual-plays/video-podcasts",
        "X-Auth-Key": PODCASTINDEX_KEY,
        "X-Auth-Date": ts,
        "Authorization": auth,
        "Accept": "application/json",
    }


def http_get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=15) as r:
        raw = r.read()
    return json.loads(raw.decode("utf-8", errors="replace"))


def is_video_episode(item: dict) -> bool:
    t = (item.get("enclosureType") or item.get("enclosure_type") or "").lower()
    u = (item.get("enclosureUrl") or item.get("enclosure_url") or "").lower()
    if t.startswith("video/"):
        return True
    if "mpegurl" in t or u.endswith(".m3u8") or ".m3u8?" in u:
        return True
    if re.search(r"\.(mp4|m4v|mov|webm)(\?|$)", u):
        return True
    return False


def add_feed(sources: list, existing_urls: set, added: list, feed_url: str, feed_title: str) -> bool:
    """Add feed if not duplicate. Returns True if added."""
    if not feed_url:
        return False
    nurl = norm_url(feed_url)
    if not nurl or nurl in existing_urls:
        return False
    base_id = slugify(feed_title) if feed_title else slugify(feed_url)
    new_id = base_id
    used_ids = {s.get("id") for s in sources if isinstance(s, dict)}
    i = 2
    while new_id in used_ids:
        new_id = f"{base_id}-{i}"
        i += 1
    entry = {
        "id": new_id,
        "title": feed_title or new_id,
        "category": "podcastindex",
        "feed_url": feed_url,
        "fetch_via": "auto",
    }
    sources.append(entry)
    existing_urls.add(nurl)
    added.append(entry)
    return True


def main() -> None:
    headers = podcastindex_headers()

    if not SOURCES_JSON.exists():
        die(f"Missing {SOURCES_JSON}")

    doc = json.loads(SOURCES_JSON.read_text("utf-8"))
    sources = doc.get("sources") or []
    if not isinstance(sources, list):
        die("video-sources.json is missing sources[]")

    existing_urls = {norm_url(s.get("feed_url", "")) for s in sources if isinstance(s, dict)}
    added = []
    seen_feed_urls = set()

    # 1. Feeds with medium=video (podcast:medium tag in RSS)
    url = f"{API_BASE}/podcasts/bytag?{urllib.parse.urlencode({'medium': 'video'})}"
    data = http_get_json(url, headers=headers)
    feeds = data.get("feeds") or data.get("feed") or []
    if not isinstance(feeds, list):
        feeds = [feeds] if isinstance(feeds, dict) else []
    for f in feeds:
        if not isinstance(f, dict):
            continue
        feed_url = (f.get("url") or f.get("feedUrl") or "").strip()
        feed_title = (f.get("title") or "").strip()
        if norm_url(feed_url) in seen_feed_urls:
            continue
        seen_feed_urls.add(norm_url(feed_url))
        if add_feed(sources, existing_urls, added, feed_url, feed_title) and len(added) >= 10:
            break

    # 2. If still short, recent episodes filtered for video enclosures
    if len(added) < 10:
        url = f"{API_BASE}/recent/episodes?{urllib.parse.urlencode({'max': 500, 'fulltext': True, 'excludeBlank': True})}"
        data = http_get_json(url, headers=headers)
        items = data.get("items") or data.get("episodes") or []
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict) or not is_video_episode(it):
                    continue
                feed_url = (it.get("feedUrl") or it.get("feedurl") or it.get("feed_url") or "").strip()
                feed_title = (it.get("feedTitle") or it.get("feedtitle") or it.get("feed_title") or "").strip()
                if norm_url(feed_url) in seen_feed_urls:
                    continue
                seen_feed_urls.add(norm_url(feed_url))
                if add_feed(sources, existing_urls, added, feed_url, feed_title) and len(added) >= 10:
                    break

    # 3. If still short, search byterm "video"
    if len(added) < 10:
        url = f"{API_BASE}/search/byterm?{urllib.parse.urlencode({'q': 'video'})}"
        data = http_get_json(url, headers=headers)
        feeds = data.get("feeds") or []
        if isinstance(feeds, list):
            for f in feeds:
                if not isinstance(f, dict):
                    continue
                feed_url = (f.get("url") or f.get("feedUrl") or "").strip()
                feed_title = (f.get("title") or "").strip()
                if norm_url(feed_url) in seen_feed_urls:
                    continue
                seen_feed_urls.add(norm_url(feed_url))
                if add_feed(sources, existing_urls, added, feed_url, feed_title) and len(added) >= 10:
                    break

    doc["sources"] = sources
    SOURCES_JSON.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", "utf-8")

    print(f"Added {len(added)} sources -> {SOURCES_JSON}")
    for e in added:
        print(f"- {e['title']}  ({e['feed_url']})")


if __name__ == "__main__":
    main()

