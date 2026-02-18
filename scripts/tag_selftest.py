from __future__ import annotations

import json
import shutil
import subprocess
import sys

from scripts.shared import extract_speakers, extract_topics, sanitize_speakers, sanitize_topics


CASES = [
    {
        "id": "simple-with",
        "title": "Episode 42 — With Alice Example and Bob Sample",
        "description": "Featuring Alice Example and Bob Sample. Topics: improv, RPGs, comedy.",
    },
    {
        "id": "feat-abbrev",
        "title": "Live special (feat. Chris Example) — Part 1",
        "description": "A big live show with Chris Example and Dana Person.",
    },
    {
        "id": "noisy",
        "title": "EPISODE 10: TRAILER — https://example.com — With The Entire Internet",
        "description": "Welcome! Topics: https://example.com, javascript, podcasting, comedy.",
    },
    {
      "id": "too-long",
      "title": "With This Name Is Definitely Far Too Long To Be A Real Person Name Probably",
      "description": "",
    },
    {
        "id": "slash-descriptor",
        "title": "British writer/actor/comedians Tim Key",
        "description": "",
    },
    {
        "id": "leading-digits",
        "title": "2024 Adam talks about things",
        "description": "",
    },
]


def _run_compromise(cases: list[dict]) -> dict[str, dict] | None:
    node = shutil.which("node")
    if not node:
        return None
    proc = subprocess.run(
        [node, "scripts/tag_compromise.mjs"],
        input=json.dumps({"items": [{"id": c["id"], "title": c["title"], "description": c["description"]} for c in cases]}).encode(
            "utf-8"
        ),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
    )
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout.decode("utf-8"))
    except Exception:
        return None


def main() -> int:
    comp = _run_compromise(CASES)
    failed = False

    for c in CASES:
        combined = f"{c['title']}\n{c['description']}"
        py_speakers = sanitize_speakers(extract_speakers(combined))
        py_topics = sanitize_topics(extract_topics(c["title"]))

        node_speakers = []
        node_topics = []
        if comp and c["id"] in comp:
            node_speakers = sanitize_speakers(comp[c["id"]].get("speakers"))
            node_topics = sanitize_topics(comp[c["id"]].get("topics"))

        print(f"\n== {c['id']} ==")
        print("title:", c["title"])
        print("py speakers:", py_speakers)
        print("py topics  :", py_topics)
        if comp:
            print("node speakers:", node_speakers)
            print("node topics  :", node_topics)

        # Minimal invariants: no absurd lengths or punctuation fragments.
        for name in py_speakers + node_speakers:
            if len(name) > 45:
                print("[fail] speaker too long:", name, file=sys.stderr)
                failed = True
            if any(ch in name for ch in (".", "!", "?", ":", "|", "—", "–", "(", ")", "[", "]", "{", "}")):
                print("[fail] speaker contains punctuation:", name, file=sys.stderr)
                failed = True

    if failed:
        print("\nTag selftest FAILED", file=sys.stderr)
        return 2

    print("\nTag selftest OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
