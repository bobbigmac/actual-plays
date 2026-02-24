# TODO (next steps before additional uses, actualplays and britcom)

## Video podcasts (high priority)

- [ ] **Performance / feed caching**: Test guide load performance with many channels. Tune Cache API TTL (currently 1h). Consider stale-while-revalidate. Ensure we don’t spam feed servers; Cache API is used for browser storage (not localStorage).

- [ ] Sleep timer: Usual sleep timer, long/slow fade outs... wake up? Rising noise/ambience? Log audio at sleep start time, so can repeat/restart and just skip forward, rather than skipping back. Sleep detected shut-off?
- [ ] Paging for unusually large indexes?
- [ ] UI tweaks: Mobile layout needs a little work for narrow viewports
- [ ] Option on feeds to avoid creating tags from those feeds (can only match other tags), like Names as Topics in news stories, rather than as speakers
- [ ] Fold player up into header on scroll
- [ ] Neater UI, nicer buttons, more modern, general style polish

## Bundling

- [ ] **Production client bundle**: build `assets/app/*` into a single `dist/assets/app.bundle.js` during `scripts.build_site.py` (keeps dev ESM+Vite, but reduces production module requests and SW precache churn).

## Optional qol

- [ ] **Clarify limitations**: Cache API doesn’t expose download byte progress, so “progress bars” can only be coarse (“caching…/done/failed”) unless we implement streamed downloads in-page.
	- Maybe wait till we make our own android app

## Needs more work, later

- [x] **Media Controls**: Currently only support prev/next but should be able to also support skip fwd/back. 
	- Bodged media controls to -15/+30 ffwd, but would like correct buttons (must be a setting for it somewhere) shown.