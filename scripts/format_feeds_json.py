from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.shared import REPO_ROOT


def _is_scalar(x: Any) -> bool:
    return x is None or isinstance(x, (str, int, float, bool))


def _dumps(obj: Any, *, indent: int, level: int = 0) -> str:
    pad = " " * (indent * level)
    pad_in = " " * (indent * (level + 1))

    if isinstance(obj, dict):
        if not obj:
            return "{}"
        lines: list[str] = ["{"]
        items = list(obj.items())
        for i, (k, v) in enumerate(items):
            key = json.dumps(k, ensure_ascii=False)
            if k == "categories" and isinstance(v, list) and all(_is_scalar(x) for x in v):
                val = "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]"
            else:
                val = _dumps(v, indent=indent, level=level + 1)
            comma = "," if i < len(items) - 1 else ""
            lines.append(f"{pad_in}{key}: {val}{comma}")
        lines.append(f"{pad}}}")
        return "\n".join(lines)

    if isinstance(obj, list):
        if not obj:
            return "[]"
        lines = ["["]
        for i, v in enumerate(obj):
            val = _dumps(v, indent=indent, level=level + 1)
            comma = "," if i < len(obj) - 1 else ""
            lines.append(f"{pad_in}{val}{comma}")
        lines.append(f"{pad}]")
        return "\n".join(lines)

    return json.dumps(obj, ensure_ascii=False)


def _format_file(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    return _dumps(data, indent=2) + "\n"


def main() -> int:
    p = argparse.ArgumentParser(description="Format feeds JSON with inline categories arrays.")
    p.add_argument(
        "files",
        nargs="*",
        help="Files to format (default: feeds*.json in repo root).",
    )
    p.add_argument("--check", action="store_true", help="Exit non-zero if any file would change.")
    args = p.parse_args()

    files = args.files
    if not files:
        files = [p.name for p in sorted(REPO_ROOT.glob("feeds*.json"))]

    changed = False
    for name in files:
        path = REPO_ROOT / name
        if not path.exists():
            continue
        formatted = _format_file(path)
        current = path.read_text(encoding="utf-8")
        if current != formatted:
            if args.check:
                print(f"[would-change] {name}")
            else:
                path.write_text(formatted, encoding="utf-8")
                print(f"[formatted] {name}")
            changed = True
        elif args.check:
            print(f"[ok] {name}")

    if args.check and changed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

