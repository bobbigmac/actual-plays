#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from scripts.shared import slugify

UA = "actual-plays-speaker-image-fetcher/1.2 (+https://github.com/)"
SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary/"
SEARCH_API = "https://en.wikipedia.org/w/api.php"
OPENVERSE_API = "https://api.openverse.org/v1/images/"
ITUNES_SEARCH_API = "https://itunes.apple.com/search"
TVMAZE_SHOW_API = "https://api.tvmaze.com/singlesearch/shows"

PERSON_DESC_HINTS = (
    "comedian",
    "actor",
    "actress",
    "writer",
    "podcaster",
    "presenter",
    "journalist",
    "politician",
    "musician",
    "singer",
)

NOISE_NAME_BITS = (
    "hosted",
    "recorded",
    "plus",
    "first",
    "join club",
    "club parsnips",
    "boiled parsnips",
    "radio days",
)

SPEAKER_RE = re.compile(
    r'data-speaker-row[^>]*data-count-guest="(?P<guest>\d+)"[^>]*data-count-total="(?P<total>\d+)"[^>]*data-name="(?P<name>[^"]+)"'
)


# Source trust and quality bias layered on top of name-match score.
SOURCE_BONUS = {
    "wikipedia": 10,
    "tvmaze": 8,
    "itunes": 6,
    "openverse": 4,
}


def _json_get(url: str, *, timeout: int = 10) -> dict[str, Any] | None:
    try:
        cp = subprocess.run(
            [
                "curl",
                "-fsSL",
                "--connect-timeout",
                "4",
                "--max-time",
                str(timeout),
                "-A",
                UA,
                url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if cp.returncode != 0:
            return None
        return json.loads(cp.stdout)
    except Exception:
        return None


def _download(url: str, out_path: Path, *, timeout: int = 30) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cp = subprocess.run(
        [
            "curl",
            "-fsSL",
            "--connect-timeout",
            "5",
            "--max-time",
            str(timeout),
            "--retry",
            "6",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "-A",
            UA,
            "-w",
            "%{content_type}",
            "-o",
            str(out_path),
            url,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if cp.returncode != 0:
        try:
            out_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise RuntimeError(cp.stderr.strip() or f"curl exit {cp.returncode}")
    return (cp.stdout or "").strip().lower()


def _extract_top_speakers(dist_speakers_html: Path, top_n: int) -> list[dict[str, Any]]:
    text = dist_speakers_html.read_text(encoding="utf-8", errors="replace")
    rows = []
    for m in SPEAKER_RE.finditer(text):
        guest = int(m.group("guest"))
        total = int(m.group("total"))
        name = html.unescape(m.group("name")).strip()
        if not name:
            continue
        rows.append({"name": name, "guest_count": guest, "total_count": total})
    return rows[:top_n]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (s or "").lower())).strip()


def _tokens(s: str) -> set[str]:
    n = _norm(s)
    if not n:
        return set()
    return {t for t in n.split(" ") if t}


def _score_title_match(name: str, title: str) -> int:
    a = _norm(name)
    b = _norm(title)
    if not a or not b:
        return 0
    if a == b:
        return 42
    if b.startswith(a):
        return 34
    if a in b:
        return 26

    at = _tokens(a)
    bt = _tokens(b)
    if not at or not bt:
        return 0
    common = len(at & bt)
    if common == 0:
        return 0

    score = min(22, common * 6)
    if common == len(at) and len(at) >= 2:
        score += 6
    return score


def _is_noise_name(name: str) -> bool:
    n = name.lower().strip()
    if any(bit in n for bit in NOISE_NAME_BITS):
        return True
    return len(n) > 40 and ("'" in n or "’" in n)


def _candidate_titles(name: str) -> list[str]:
    base = re.sub(r"\s+", " ", name.strip())
    if not base:
        return []

    out = [base]
    if base.endswith("'S") or base.endswith("'s"):
        out.append(base[:-2].strip())
    if "’" in base:
        out.append(base.replace("’", ""))
    if "'" in base:
        out.append(base.replace("'", ""))

    # Hint variant helps for some public-person pages.
    out.append(f"{base} (comedian)")

    seen = set()
    uniq = []
    for t in out:
        k = t.lower().strip()
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(t)
    return uniq


def _with_score(source: str, score: int) -> int:
    return score + SOURCE_BONUS.get(source, 0)


def _fetch_summary(title: str) -> dict[str, Any] | None:
    slug = title.replace(" ", "_")
    url = SUMMARY_API + urllib.parse.quote(slug, safe="()_-")
    return _json_get(url, timeout=4)


def _search_fallback_title(name: str) -> str | None:
    params = {
        "action": "query",
        "format": "json",
        "list": "search",
        "srsearch": name,
        "srlimit": "3",
        "utf8": "1",
    }
    url = SEARCH_API + "?" + urllib.parse.urlencode(params)
    data = _json_get(url, timeout=4)
    if not data:
        return None
    results = ((data.get("query") or {}).get("search") or [])
    if not results:
        return None
    t = str(results[0].get("title") or "").strip()
    return t or None


def _wikipedia_best(name: str) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None

    def consider(summary: dict[str, Any], matched_title: str) -> None:
        nonlocal best
        title = str(summary.get("title") or "")
        desc = str(summary.get("description") or "").lower()
        typ = str(summary.get("type") or "")

        score = _score_title_match(name, title)
        if typ == "standard":
            score += 8
        else:
            score -= 8
        if "disambiguation" in desc:
            score -= 20
        if any(h in desc for h in PERSON_DESC_HINTS):
            score += 8

        item = {
            "source": "wikipedia",
            "score": _with_score("wikipedia", score),
            "title": title,
            "matched_title": matched_title,
            "page_url": str(summary.get("content_urls", {}).get("desktop", {}).get("page") or ""),
            "image_url": str((summary.get("thumbnail") or {}).get("source") or ""),
            "description": str(summary.get("description") or ""),
        }
        if (best is None) or int(item["score"]) > int(best.get("score") or -999):
            best = item

    for t in _candidate_titles(name):
        summary = _fetch_summary(t)
        if summary:
            consider(summary, t)

    if best is None:
        fallback_title = _search_fallback_title(name)
        if fallback_title:
            summary = _fetch_summary(fallback_title)
            if summary:
                consider(summary, fallback_title)

    return best


def _openverse_best(name: str) -> dict[str, Any] | None:
    params = {
        "q": name,
        "page_size": "12",
        "mature": "false",
        "filter_dead": "true",
    }
    url = OPENVERSE_API + "?" + urllib.parse.urlencode(params)
    data = _json_get(url, timeout=6)
    if not data:
        return None

    best: dict[str, Any] | None = None
    for r in (data.get("results") or []):
        if not isinstance(r, dict):
            continue
        title = str(r.get("title") or "").strip() or str(r.get("id") or "")
        image_url = str(r.get("thumbnail") or r.get("url") or "").strip()
        if not image_url:
            continue

        score = _score_title_match(name, title)
        if r.get("creator"):
            score += 2

        item = {
            "source": "openverse",
            "score": _with_score("openverse", score),
            "title": title,
            "matched_title": title,
            "page_url": str(r.get("foreign_landing_url") or r.get("url") or ""),
            "image_url": image_url,
            "description": str(r.get("creator") or ""),
        }
        if (best is None) or int(item["score"]) > int(best.get("score") or -999):
            best = item

    return best


def _itunes_best(name: str) -> dict[str, Any] | None:
    params = {
        "term": name,
        "media": "podcast",
        "entity": "podcast",
        "limit": "12",
    }
    url = ITUNES_SEARCH_API + "?" + urllib.parse.urlencode(params)
    data = _json_get(url, timeout=6)
    if not data:
        return None

    best: dict[str, Any] | None = None
    for r in (data.get("results") or []):
        if not isinstance(r, dict):
            continue
        title = str(r.get("collectionName") or "").strip()
        artist = str(r.get("artistName") or "").strip()
        image_url = str(r.get("artworkUrl600") or r.get("artworkUrl100") or "").strip()
        if not title or not image_url:
            continue

        score = _score_title_match(name, title)
        if artist and _score_title_match(name, artist) >= 20:
            score += 4

        item = {
            "source": "itunes",
            "score": _with_score("itunes", score),
            "title": title,
            "matched_title": title,
            "page_url": str(r.get("collectionViewUrl") or ""),
            "image_url": image_url,
            "description": artist,
        }
        if (best is None) or int(item["score"]) > int(best.get("score") or -999):
            best = item

    return best


def _tvmaze_best(name: str) -> dict[str, Any] | None:
    url = TVMAZE_SHOW_API + "?" + urllib.parse.urlencode({"q": name})
    data = _json_get(url, timeout=6)
    if not data or not isinstance(data, dict):
        return None

    title = str(data.get("name") or "").strip()
    if not title:
        return None
    image = data.get("image") or {}
    image_url = str(image.get("original") or image.get("medium") or "").strip()
    if not image_url:
        return None

    score = _score_title_match(name, title)
    if data.get("type"):
        score += 2

    return {
        "source": "tvmaze",
        "score": _with_score("tvmaze", score),
        "title": title,
        "matched_title": title,
        "page_url": str(data.get("url") or ""),
        "image_url": image_url,
        "description": str(data.get("type") or ""),
    }


def _choose_image(name: str, min_score: int) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []

    wiki = _wikipedia_best(name)
    if wiki:
        candidates.append(wiki)

    for f in (_openverse_best, _itunes_best, _tvmaze_best):
        c = f(name)
        if c:
            candidates.append(c)

    if not candidates:
        return None

    candidates.sort(key=lambda x: int(x.get("score") or -999), reverse=True)
    best = candidates[0]

    out = {
        "speaker": name,
        "score": int(best.get("score") or 0),
        "title": str(best.get("title") or ""),
        "matched_title": str(best.get("matched_title") or ""),
        "page_url": str(best.get("page_url") or ""),
        "image_url": str(best.get("image_url") or ""),
        "description": str(best.get("description") or ""),
        "source": str(best.get("source") or ""),
    }

    if not out["image_url"]:
        return {"status": "no_image", **out}

    if out["score"] < min_score:
        return {"status": "low_confidence", **out}

    return {"status": "ok", **out}


def _ext_from_url(url: str) -> str:
    p = urllib.parse.urlparse(url).path.lower()
    if p.endswith(".png"):
        return ".png"
    if p.endswith(".webp"):
        return ".webp"
    if p.endswith(".jpeg"):
        return ".jpeg"
    if p.endswith(".jpg"):
        return ".jpg"
    return ".jpg"


def _process_one(
    idx: int,
    total: int,
    row: dict[str, Any],
    *,
    out_dir: Path,
    min_score: int,
    skip_noise: bool,
) -> dict[str, Any]:
    name = str(row["name"])
    speaker_slug = slugify(name)

    existing = sorted(out_dir.glob(f"{speaker_slug}.*"))
    if existing:
        return {
            "rank": idx,
            **row,
            "slug": speaker_slug,
            "status": "exists",
            "file": existing[0].name,
        }

    if skip_noise and _is_noise_name(name):
        return {
            "rank": idx,
            **row,
            "slug": speaker_slug,
            "status": "skipped_noise",
        }

    chosen = _choose_image(name, min_score=min_score)
    if not chosen:
        return {
            "rank": idx,
            **row,
            "slug": speaker_slug,
            "status": "no_result",
        }

    if chosen.get("status") != "ok":
        return {
            "rank": idx,
            **row,
            "slug": speaker_slug,
            **chosen,
        }

    out_name = f"{speaker_slug}{_ext_from_url(str(chosen['image_url']))}"
    out_path = out_dir / out_name

    try:
        content_type = _download(str(chosen["image_url"]), out_path)
        return {
            "rank": idx,
            **row,
            "slug": speaker_slug,
            **chosen,
            "file": out_name,
            "content_type": content_type,
        }
    except Exception as e:
        return {
            "rank": idx,
            **row,
            "slug": speaker_slug,
            **chosen,
            "status": "download_error",
            "error": str(e),
        }


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch top speaker images from multiple public sources")
    ap.add_argument("--speakers-html", default="dist/speakers/index.html", help="Path to built speakers index HTML")
    ap.add_argument("--top", type=int, default=100, help="How many top speakers to process")
    ap.add_argument("--min-score", type=int, default=28, help="Minimum confidence score to auto-download")
    ap.add_argument("--workers", type=int, default=6, help="Parallel worker count")
    ap.add_argument("--out-dir", default="site/assets/images/speakers", help="Output directory")
    ap.add_argument("--report", default="site/assets/images/speakers/_sources.json", help="Report JSON path")
    ap.add_argument("--skip-noise", action="store_true", help="Skip obvious non-person speaker labels")
    args = ap.parse_args()

    speakers_html = Path(args.speakers_html)
    out_dir = Path(args.out_dir)
    report_path = Path(args.report)

    top = _extract_top_speakers(speakers_html, top_n=args.top)
    if not top:
        print(f"No speakers found in {speakers_html}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    report: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {
            ex.submit(
                _process_one,
                i,
                len(top),
                row,
                out_dir=out_dir,
                min_score=args.min_score,
                skip_noise=args.skip_noise,
            ): (i, row)
            for i, row in enumerate(top, start=1)
        }
        for fut in as_completed(futs):
            i, row = futs[fut]
            try:
                r = fut.result()
            except Exception as e:
                r = {
                    "rank": i,
                    **row,
                    "slug": slugify(str(row.get("name") or "")),
                    "status": "error",
                    "error": str(e),
                }
            report.append(r)
            print(f"[{r.get('rank', i):03d}/{len(top):03d}] {r.get('status')} {r.get('name')}")

    report.sort(key=lambda x: int(x.get("rank") or 0))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts: dict[str, int] = {}
    for r in report:
        s = str(r.get("status") or "")
        counts[s] = counts.get(s, 0) + 1

    summary = " ".join(f"{k}={v}" for k, v in sorted(counts.items()))
    print(f"done: {summary} report={report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
