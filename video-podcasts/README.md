# Video Podcasts

A minimal video-podcast player that ships a video site with broad market reach while staying suitable for niches. Feed sources are configurable; the same app can serve church sermons, university lectures, fitness, tech shows, or any video RSS.

## Features

- **Feed switching** — Channel-style feed list; switch feeds without losing place
- **Per-episode and per-feed position** — Progress and last-played state persisted
- **Chapters** — Inline (Podlove Simple Chapters) and external (Podcasting 2.0 JSON)
- **Log panel** — Status and errors for feed loading, enclosure detection, and playback
- **Offline-friendly** — Cached feeds and media where possible

## Goals

- **Broad base, niche-friendly** — One app for many audiences; pre-filtering by category or chapter (e.g. sermons only, no filler; or just computing lectures) is a target
- **Segment skip** — Use chapters/categories to skip filler and jump to desired content
- **Detection limits** — We work with what we can detect from feeds; a GitHub Action helps fix or enrich data where needed

## Todos

- [ ] **Background feed updates** — Server occasionally refreshes every feed; cached version is always available so users can browse even when not up to date
- [ ] **Video enclosure checks** — Backend (GitHub Action) validates video enclosures per feed: either disable feeds without video or restrict to entries that have video
- [ ] **No audio-only playback** — UI must never play an audio-only stream in early release (later: possible generated-video wrapper for audio)
