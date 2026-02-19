from __future__ import annotations

import argparse
from pathlib import Path

from scripts.feeds_md import dumps_feeds_markdown
from scripts.shared import REPO_ROOT, read_json


def main() -> int:
    p = argparse.ArgumentParser(description="Convert feeds*.json configs into conventional Markdown feeds*.md.")
    p.add_argument(
        "files",
        nargs="*",
        help="Input JSON files (default: all feeds*.json in repo root).",
    )
    p.add_argument(
        "--out-dir",
        default=".",
        help="Output directory (default: repo root).",
    )
    args = p.parse_args()

    out_dir = (REPO_ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    inputs: list[Path] = []
    if args.files:
        for f in args.files:
            path = (REPO_ROOT / f).resolve() if not Path(f).is_absolute() else Path(f)
            inputs.append(path)
    else:
        inputs = sorted(REPO_ROOT.glob("feeds*.json"))

    if not inputs:
        raise SystemExit("No feeds*.json files found.")

    for in_path in inputs:
        if not in_path.exists():
            raise SystemExit(f"Missing input: {in_path}")
        cfg = read_json(in_path)
        md = dumps_feeds_markdown(cfg)
        out_name = in_path.name.rsplit(".", 1)[0] + ".md"
        out_path = out_dir / out_name
        out_path.write_text(md, encoding="utf-8")
        print(f"[converted] {in_path.relative_to(REPO_ROOT)} -> {out_path.relative_to(REPO_ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

