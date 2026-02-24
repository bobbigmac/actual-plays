# Video Podcasts

A minimal video-podcast player that ships a video site with broad market reach while staying suitable for niches. Feed sources are configurable; the same app can serve church sermons, university lectures, fitness, tech shows, or any video RSS.

## Features

- **Feed switching** — Channel-style feed list; switch feeds without losing place
- **Per-episode and per-feed position** — Progress and last-played state persisted
- **Chapters** — Inline (Podlove Simple Chapters) and external (Podcasting 2.0 JSON)
- **Subtitles** — WebVTT and SRT via `podcast:transcript`
- **Log panel** — Status and errors for feed loading, enclosure detection, and playback
- **History** — Session log of played segments with restart/continue
- **Sleep timer** — Countdown then pause; segments touched by sleep show dimming gradient

## Todos

- [ ] **State manager** — Needs a proper state manager; current ad-hoc state is a mess
- [ ] **Sleep: fade volume** — Gradually lower volume before pause
- [ ] **Sleep: end-of-episode** — Option to stop at end of current episode instead of timer
- [ ] **Sleep: resume prompt** — After sleep, offer to resume from same point
- [ ] **Sleep: persist preference** — Remember last-used duration
