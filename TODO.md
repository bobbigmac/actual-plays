# TODO (next steps)

This repo now has a modular client (`site/assets/app/*`) with a single state model + SPA navigation. The next steps are mostly about polish, maintainability, and making offline/search feel “complete”.

## Offline UX

- [ ] **Make search results fully offline-aware** by including `audio_url` (and `link_url`) in `dist/index.json` so search rows can show `Offline ✓` immediately (no fetch/resolve needed).
- [ ] **Add a “Retry / why didn’t this cache?” state** for Offline button failures (SW inactive / CORS opaque / no audio URL) with a short user-facing hint.
- [ ] **Clarify limitations**: Cache API doesn’t expose download byte progress, so “progress bars” can only be coarse (“caching…/done/failed”) unless we implement streamed downloads in-page.


- [ ] **Media Controls**: Currently only support prev/next but should be able to also support skip fwd/back
- [ ] **UI tweaks**: Mobile layout needs a little work for narrow viewports

## Bundling (optional)

- [ ] **Production client bundle**: build `assets/app/*` into a single `dist/assets/app.bundle.js` during `scripts.build_site.py` (keeps dev ESM+Vite, but reduces production module requests and SW precache churn).

## Consistency & Maintainability

- [ ] **Standardize episode-row HTML**: keep one canonical set of `data-*` fields and markup between SSR pages and client-rendered lists (home/search) so features don’t “only work in one place”.
- [ ] **Small smoke checks**: add a simple script that runs build and asserts key outputs exist (`dist/index.html`, `dist/index.json`, `dist/sw.js`, `dist/manifest.webmanifest`) to catch regressions early.

## Optional cleanup

- [x] Port remaining useful “hub” ideas to `FUTURE.md`.
