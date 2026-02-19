# TODO (client refactor + state model)

Goal: keep server-rendered HTML pages, but have **one client-side state model** that:
- persists across cold load + SPA navigation
- drives UI consistently anywhere an episode appears (home/latest/search/podcast page/speaker page)
- supports offline download/caching progress + status per episode/audio URL
- keeps concerns separated so we can iterate without touching a giant file

## Decisions (proposed)

- **State model first, framework optional.** Build a small store/event layer that doesn’t depend on any UI library.
- **If/when we add a UI library, prefer Preact** (React-like ergonomics without React’s footprint), ideally as “islands” over existing SSR HTML.
- **Bundling is optional but likely worth it** once modules stabilize (Vite build into a single/minified client bundle during `scripts.build_site`).

## Phase 1 — State model (no framework)

- [x] Create `site/assets/app/store.js` (lightweight store + subscriptions)
- [x] Define state shape + persistence keys (localStorage/IDB as appropriate):
  - play history / queue
  - per-episode progress
  - per-feed speed settings
  - offline settings
  - offline cache index + **download jobs**
- [ ] Add an event bridge so non-UI modules can publish state changes (partial):
  - player updates progress
  - offline module publishes job progress + cache status changes
  - search/navigation can trigger re-render hooks

Acceptance:
- One “source of truth” for episode state.
- A single subscription point can update *any* view.

## Phase 2 — Offline progress everywhere

- [x] Change `site/assets/app/offline.js` to emit structured events/job updates into the store:
  - `job.start`, `job.item`, `job.done`, `cache.changed`, `sw.inactive`, `quota.near`
- [x] Normalize job identity by audio URL (store keys by `url`)
- [ ] Add UI hooks for any episode row (partial):
  - Offline button state: `Offline` / `Caching…` / `Offline ✓` / `Retry`
  - Per-episode progress indicator for downloads (tiny bar/text)
- [x] Ensure updates survive navigation (SPA) and are reflected on all pages.

Acceptance:
- Clicking “Download now” shows progress in Data panel **and** on the episode rows being downloaded (where visible).
- Button states change immediately and stay correct after navigation.

## Phase 3 — Split `site/assets/app/index.js` by responsibility

Target modules (suggested):
- [x] `site/assets/app/player.js`
- [x] `site/assets/app/state/progress.js`
- [x] `site/assets/app/state/queue.js`
- [x] `site/assets/app/state/history.js`
- [x] `site/assets/app/search.js`
- [x] `site/assets/app/navigation.js`
- [x] `site/assets/app/ui/speakers.js`
- [x] `site/assets/app/episode_actions.js`
- [x] `site/assets/app/home.js`
- [x] `site/assets/app/data_panel.js`
- [x] `site/assets/app/offline.js`

Acceptance:
- `index.js` becomes a thin composition/root file.
- Modules communicate via the store, not direct DOM knowledge of each other.

## Phase 4 — Client bundle build step (optional, after refactor)

- [ ] Add a `build_clientjs` step executed *inside* `python -m scripts.build_site`:
  - outputs `dist/assets/app.bundle.js` (and optional CSS)
  - updates `site/templates/base.html` + `site/pwa/sw.js` to reference the bundle
- [ ] Update GitHub Action to install Node only if bundling is enabled.

Acceptance:
- Local dev remains fast (ESM modules via Vite dev server).
- Production output is smaller/faster (single minified bundle).

## Phase 5 — UI componentization (optional)

- [ ] If we adopt Preact: mount only where it helps (episode rows/search/data panel), keep SSR as the baseline.
- [ ] Standardize controls/components (menu, toggles, buttons, episode row).
