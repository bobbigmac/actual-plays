This folder contains optional per-feed “profile” markdown files that are loaded at build time.

- File name: `feed-profiles/<feed-slug>.md`
- Format: optional simple front matter + markdown body.

Example:

```md
---
editors_note: Quick 1‑liner shown on cards and the podcast page.
score_production: 4
score_pacing: 5
score_clarity: 4
score_vibe: 5
---
Longer notes go here. Supports basic markdown (headings, lists, links).
```

Notes:

- If a feed entry also sets `editors_note` in `feeds*.json`, the profile’s `editors_note` wins.
- Scores are optional; any numeric `score_*` / `rating_*` fields render as a small ratings grid.
