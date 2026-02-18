from __future__ import annotations

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
    {
        "id": "trailing-punct-1",
        "title": "Episode 12 — With Lou Beckett.",
        "description": "A chat with Lou Beckett. about comedy writing.",
    },
    {
        "id": "trailing-punct-2",
        "title": "Episode 13 — With Ray Bradshaw..",
        "description": "Ray Bradshaw.. joins us for a chat.",
    },
    {
        "id": "ellipsis-descriptor",
        "title": "Episode 14 — With Josh Widdicombe… Valentines Special",
        "description": "",
    },
]


def _run_spacy(cases: list[dict]) -> dict[str, dict] | None:
    try:
        import spacy  # type: ignore
    except Exception:
        return None
    try:
        nlp = spacy.load("en_core_web_sm", disable=["parser"])
    except Exception:
        return None

    ids = [c["id"] for c in cases]
    texts = [f"{c['title']}\n{c['description']}"[:8000] for c in cases]
    title_texts = [c["title"] for c in cases]

    docs = list(nlp.pipe(texts, batch_size=16))
    title_docs = list(nlp.pipe(title_texts, batch_size=32))

    out: dict[str, dict] = {}
    for cid, doc, tdoc in zip(ids, docs, title_docs, strict=False):
        speakers = [ent.text for ent in doc.ents if ent.label_ == "PERSON"]
        topics = [
            (tok.lemma_ or tok.text).lower()
            for tok in tdoc
            if tok.pos_ in ("NOUN", "PROPN") and tok.is_alpha and not tok.is_stop
        ]
        out[cid] = {"speakers": sanitize_speakers(speakers), "topics": sanitize_topics(topics)}
    return out


def main() -> int:
    spacy_out = _run_spacy(CASES)
    failed = False

    for c in CASES:
        combined = f"{c['title']}\n{c['description']}"
        py_speakers = sanitize_speakers(extract_speakers(combined))
        py_topics = sanitize_topics(extract_topics(c["title"]))

        print(f"\n== {c['id']} ==")
        print("title:", c["title"])
        print("py speakers:", py_speakers)
        print("py topics  :", py_topics)
        if spacy_out and c["id"] in spacy_out:
            print("spacy speakers:", spacy_out[c["id"]].get("speakers"))
            print("spacy topics  :", spacy_out[c["id"]].get("topics"))

        # Minimal invariants: no absurd lengths or punctuation fragments.
        for name in py_speakers + (spacy_out[c["id"]].get("speakers") if spacy_out and c["id"] in spacy_out else []):
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
