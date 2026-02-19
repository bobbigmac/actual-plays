from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from scripts.shared import REPO_ROOT, fetch_url, parse_feed, read_feeds_config, slugify


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate a promo OpenGraph image collage from feed artwork.")
    p.add_argument("--feeds", default="feeds.md", help="Feeds config markdown (.md).")
    p.add_argument("--out", required=True, help="Output image path (e.g. site/assets/promo-other.jpg).")
    p.add_argument("--count", type=int, default=18, help="Number of tiles (default: 18).")
    p.add_argument("--tile", type=int, default=180, help="Tile size in pixels (default: 180).")
    p.add_argument("--cols", type=int, default=6, help="Columns (default: 6).")
    p.add_argument("--rows", type=int, default=3, help="Rows (default: 3).")
    p.add_argument("--gap", type=int, default=10, help="Gap between tiles (default: 10).")
    p.add_argument("--border", type=int, default=35, help="Outer border (default: 35).")
    p.add_argument("--bg", default="#0b0c0f", help="Background/border color (default: #0b0c0f).")
    p.add_argument("--size", default="1200x630", help="Final output size (default: 1200x630).")
    p.add_argument("--max-feeds", type=int, default=250, help="Max feeds to scan (default: 250).")
    p.add_argument("--concurrency", type=int, default=8, help="Concurrent feed fetches (default: 8).")
    return p.parse_args()


def _run(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError as e:
        raise RuntimeError("ImageMagick not found. Install `magick` (ImageMagick 7).") from e


def _is_http(url: str) -> bool:
    u = str(url or "").strip()
    return u.startswith("http://") or u.startswith("https://")


def _download_bytes(url: str, *, timeout: int, user_agent: str) -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        ct = str(resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        data = resp.read()
        return data, ct


def _ext_for_ct(ct: str) -> str:
    if ct.endswith("png"):
        return "png"
    if ct.endswith("jpeg") or ct.endswith("jpg"):
        return "jpg"
    if ct.endswith("webp"):
        return "webp"
    if ct.endswith("gif"):
        return "gif"
    return "img"


def _pick_feed_image_urls(cfg: dict[str, Any], *, timeout: int, user_agent: str, max_feeds: int) -> list[str]:
    feeds = cfg.get("feeds") or []
    if not isinstance(feeds, list):
        return []

    urls: list[str] = []
    for f in feeds[:max_feeds]:
        if not isinstance(f, dict):
            continue
        feed_url = str(f.get("url") or "").strip()
        if _is_http(feed_url):
            urls.append(feed_url)

    seen: set[str] = set()
    uniq: list[str] = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        uniq.append(u)
    return uniq


def _extract_feed_art_url(feed_url: str, *, timeout: int, user_agent: str) -> str | None:
    try:
        r = fetch_url(feed_url, timeout_seconds=timeout, user_agent=user_agent)
        if r.status != 200 or not r.content:
            return None
        parsed = parse_feed(r.content, source_url=feed_url)
        img = str(parsed.get("image_url") or "").strip()
        return img if _is_http(img) else None
    except Exception:
        return None


def main() -> int:
    args = _parse_args()
    feeds_path = REPO_ROOT / args.feeds
    out_path = REPO_ROOT / args.out

    cfg = read_feeds_config(feeds_path)
    defaults = cfg.get("defaults") if isinstance(cfg, dict) else None
    if not isinstance(defaults, dict):
        defaults = {}

    timeout = int(defaults.get("request_timeout_seconds") or 20)
    timeout = max(5, min(timeout, 60))
    user_agent = str(defaults.get("user_agent") or "static-podcast-index/1.0 (+https://github.com/)")

    need = int(args.count or 18)
    cols = int(args.cols or 6)
    rows = int(args.rows or 3)
    if need != cols * rows:
        print(f"[warn] count ({need}) != cols*rows ({cols}*{rows}={cols*rows}); using count={need}", file=sys.stderr)

    feed_urls = _pick_feed_image_urls(cfg, timeout=timeout, user_agent=user_agent, max_feeds=int(args.max_feeds or 250))
    if not feed_urls:
        print("[error] No feed URLs found in config.", file=sys.stderr)
        print(f"Feeds: {feeds_path}", file=sys.stderr)
        return 2

    # Prefer variety: stable spread across the list, then fall back to the full list.
    spread_idx: list[int] = []
    for i in range(min(len(feed_urls), need * 12)):
        idx = int(i * len(feed_urls) / (need * 12))
        if idx not in spread_idx:
            spread_idx.append(idx)
    candidates = [feed_urls[i] for i in spread_idx] + feed_urls

    # Download and dedupe by content hash (many podcasts reuse the same host/placeholder artwork).
    with tempfile.TemporaryDirectory(prefix="ap-promo-") as tmp:
        tmp_dir = Path(tmp)
        src_dir = tmp_dir / "src"
        tile_dir = tmp_dir / "tiles"
        src_dir.mkdir(parents=True, exist_ok=True)
        tile_dir.mkdir(parents=True, exist_ok=True)

        got = 0
        seen_hash: set[str] = set()
        seen_slug: set[str] = set()

        # Fetch feed XML (to get image URLs) concurrently; download/tiling happens in the main thread.
        # Important: don't queue hundreds of fetches at once, otherwise we end up waiting for slow timeouts
        # even after we've already collected enough tiles.
        conc = int(args.concurrency or 8)
        conc = max(1, min(conc, 16))
        in_flight_max = conc * 2

        it = iter(candidates)
        pending = set()
        with ThreadPoolExecutor(max_workers=conc) as pool:
            while len(pending) < in_flight_max:
                try:
                    feed_url = next(it)
                except StopIteration:
                    break
                pending.add(pool.submit(_extract_feed_art_url, feed_url, timeout=timeout, user_agent=user_agent))

            while pending and got < need:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for fut in done:
                    if got >= need:
                        break
                    url = fut.result() or ""
                    if not url:
                        continue
                    try:
                        data, ct = _download_bytes(url, timeout=timeout, user_agent=user_agent)
                    except urllib.error.HTTPError:
                        continue
                    except Exception:
                        continue
                    if not data or len(data) < 10_000:
                        continue
                    if ct and not (ct.startswith("image/") or ct == "application/octet-stream"):
                        continue

                    h = hashlib.sha1(data).hexdigest()
                    if h in seen_hash:
                        continue
                    seen_hash.add(h)

                    # Avoid grabbing multiple different URLs that are clearly the same show art by filename-y slug.
                    # (This is intentionally fuzzy; the content hash is the real dedupe.)
                    try:
                        path = urllib.parse.urlparse(url).path
                        base = Path(path).name
                        base = re.sub(r"\.(jpg|jpeg|png|webp|gif)$", "", base, flags=re.I)
                        s = slugify(base)[:60]
                        if s and s in seen_slug:
                            continue
                        if s:
                            seen_slug.add(s)
                    except Exception:
                        pass

                    ext = _ext_for_ct(ct)
                    src = src_dir / f"src{got+1:02d}.{ext}"
                    src.write_bytes(data)
                    tile = tile_dir / f"t{got+1:02d}.png"

                    # Create a square tile with center crop.
                    _run(
                        [
                            "magick",
                            str(src),
                            "-thumbnail",
                            f"{int(args.tile)}x{int(args.tile)}^",
                            "-gravity",
                            "center",
                            "-extent",
                            f"{int(args.tile)}x{int(args.tile)}",
                            str(tile),
                        ]
                    )
                    got += 1
                    print(f"[tile] {got}/{need}", file=sys.stderr)

                while len(pending) < in_flight_max and got < need:
                    try:
                        feed_url = next(it)
                    except StopIteration:
                        break
                    pending.add(pool.submit(_extract_feed_art_url, feed_url, timeout=timeout, user_agent=user_agent))

        if got < need:
            print(f"[error] Only got {got}/{need} unique tiles.", file=sys.stderr)
            print("Try increasing --max-feeds or raising timeouts in the feeds config defaults.", file=sys.stderr)
            return 2

        montage = tmp_dir / "montage.png"
        tile_paths = [str(tile_dir / f"t{i:02d}.png") for i in range(1, need + 1)]
        _run(
            [
                "magick",
                "montage",
                *tile_paths,
                "-tile",
                f"{cols}x{rows}",
                "-geometry",
                f"{int(args.tile)}x{int(args.tile)}+{int(args.gap)}+{int(args.gap)}",
                "-background",
                str(args.bg),
                str(montage),
            ]
        )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_out = tmp_dir / "out.jpg"
        _run(
            [
                "magick",
                str(montage),
                "-bordercolor",
                str(args.bg),
                "-border",
                str(int(args.border)),
                "-strip",
                "-quality",
                "85",
                str(tmp_out),
            ]
        )
        _run(
            [
                "magick",
                str(tmp_out),
                "-resize",
                str(args.size) + "^",
                "-gravity",
                "center",
                "-extent",
                str(args.size),
                "-strip",
                "-quality",
                "85",
                str(out_path),
            ]
        )

    print(f"[promo] {feeds_path} -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
