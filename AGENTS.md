# AGENTS.md (repo guide)

This repo builds a static podcast browser with server-rendered HTML + a modular client app that keeps state (history/queue/progress/offline) consistent across SPA-style navigation.

## Process notes

- Build output lives in `dist/` (served by Vite in dev); generate it with `python3 -m scripts.build_site --base-path /`.
- The client is split into ESM modules under `site/assets/app/`; the HTML always loads `site/assets/app.js`, which bootstraps `assets/app/index.js`.
- If you add/move client modules, update the service worker precache list in `site/pwa/sw.js` so offline first-load doesn’t break.
- Offline caching (art/audio) is handled by the service worker + a small client wrapper; the UI reads offline state from the store, not ad-hoc DOM.

## File map (1 line per file)

- `package.json` — dev scripts (`update/build/dev`) and dependency entrypoint for local workflows.
- `feeds.json` — primary feeds config for this deployment (URLs + optional `owners`/`common_speakers`/`categories`).
- `feeds.actualplays.json` — OPML-derived feeds config for actual plays / RPG / story / fiction subscriptions.
- `feeds.other.json` — OPML-derived feeds config for non-TTRPG subscriptions.
- `feed-profiles/*.md` — optional per-feed profile markdown (editor’s notes + optional ratings), keyed by feed slug.
- `vite.config.js` — Vite dev server rooted at `dist/` + dev plugin that rebuilds/copies assets and broadcasts build status.
- `scripts/update_feeds.py` — fetches/updates feed cache and tagging inputs used by the build.
- `scripts/build_site.py` — renders pages + emits `dist/index.json` search index and `dist/site.json` config.
- `scripts/format_feeds_json.py` — formats `feeds*.json` with inline `categories` arrays (less line-bloat).
- `scripts/py` — Python launcher that prefers `.venv/` (needed for spaCy on PEP 668 systems).
- `site/templates/base.html` — shared SSR template; includes search panel skeleton + loads `assets/app.js`.
- `site/assets/app.js` — stable loader that resolves base path and imports `assets/app/index.js` as a module.
- `site/pwa/sw.js` — service worker: precaches static app assets, runtime-caches artwork, and explicitly caches audio on request.

### Client root + model

- `site/assets/app/index.js` — thin composition root: boot player/search/nav/data panel and refresh UI on state changes/navigation.
- `site/assets/app/store.js` — minimal store (`getState/update/subscribe`) used as the single UI/event hub.
- `site/assets/app/model.js` — app model singleton: persisted state snapshots + offline job/cached maps pushed by modules.
- `site/assets/app/storage.js` — localStorage helpers + `LS_PREFIX` namespace.
- `site/assets/app/env.js` — reads base path + site config from `window.__PODCAST_INDEX__`.
- `site/assets/app/dom.js` — DOM/query helpers + escaping utilities.

### Views / controllers

- `site/assets/app/player.js` — audio player controller; restores “current” on refresh, writes progress, and updates media/session UI.
- `site/assets/app/home.js` — home-only panels (history/queue/latest ordering) rendered from persisted state.
- `site/assets/app/search.js` — search “page” panel backed by `dist/index.json`; renders SSR-like episode rows for actions/progress.
- `site/assets/app/episode_actions.js` — global click handler for episode rows (`play/queue/played/bulk/offline`) and persistence.
- `site/assets/app/navigation.js` — SPA navigation: fetches next HTML, swaps main content, preserves player/search context.
- `site/assets/app/pwa.js` — SW registration + diagnostics (logs `[pwa] …`).

### Offline

- `site/assets/app/offline.js` — low-level offline logic (storage estimates, SW messaging, auto-cache queue) + emits structured events.
- `site/assets/app/offline_api.js` — app-facing offline wrapper that bridges `offline.js` events into `model.js` store state.

### State (persistence)

- `site/assets/app/state/history.js` — play history persistence (load/save/push/remove).
- `site/assets/app/state/queue.js` — queue persistence + cached membership set helpers.
- `site/assets/app/state/progress.js` — per-episode progress persistence (`p/d/u/c`).

### UI helpers

- `site/assets/app/ui/episode_dom.js` — episode-row DOM refreshers (progress/queue/offline button states) driven by persisted state.
- `site/assets/app/ui/art.js` — artwork rendering with fallbacks (initials/hue).
- `site/assets/app/ui/lazy_images.js` — swaps `img[data-src]` into `src` on viewport approach to avoid jank/layout judder.
- `site/assets/app/ui/header_offset.js` — keeps sticky player aligned under sticky header.
- `site/assets/app/ui/descriptions.js` — “show full description” expansion in-flow (no duplicating text).
- `site/assets/app/ui/menus.js` — details/summary “burger” menu behavior + click-outside closing.
- `site/assets/app/ui/speakers.js` — speakers-page toggles (e.g. include/exclude own podcast) + state persistence hooks.

### Utils

- `site/assets/app/util/bytes.js` — byte-size formatting helper for UI (uses `?MB` fallback).
- `site/assets/app/util/time.js` — time formatting helpers for progress UI.
- `site/assets/app/util/url.js` — querystring helpers used for `?e=` and `?q=` without breaking SPA navigation.
