## BackgroundTV (working name)

A vibes-based, open-feed “TV set” you can leave on. Minimal UI, channel surfing behaviour, and curated channel packs for places and people who want slow/background viewing on a second screen: bars, offices, workshops, “I just want something on”.

It’s not a directory, not a social video platform, not “premium video podcasts”. It’s a tiny, cheap-to-run web app that turns sets of OpenRSS / video RSS / HLS-ish feeds into a coherent, always-on TV experience, with optional enrichment done offline via a GitHub Actions pipeline.

### Who it’s for

* Sports bars and pubs: always-on “TV” that isn’t tied to broadcast rights, and can be themed (sports talk, highlights, analysis, adjacent content).
* “Brainbox” corners: lecture channels, tech talks, free university pods, conference rooms.
* Homes + desks: second-screen people who want ambient content without choice paralysis.
* Niche communities: churchy/sermon sets, maker/hacker sets, fitness sets, etc.

### The product

A web-first “TV set” with:

* **Channel-style feed list** (switch feeds without losing place). 
* **Per-feed and per-episode position** (it remembers where you were on each channel). 
* **Chapters support** where available (Podlove Simple Chapters + Podcasting 2.0 JSON), with room to enrich missing chapter data server-side. 
* **Offline-friendly browsing** via cached feed data and whatever media caching the browser allows. 
* **Log/status panel** for debugging feed load/enclosure/playback failures (useful for curators, and for keeping deployments stable). 

The core rule early on: **no audio-only playback**. If there’s no real video enclosure, the item/feed doesn’t play. 

### The “TV” behaviours (what makes it feel like a set)

The app isn’t trying to be a good library, it’s trying to be good background TV:

* **Profiles**: small sets of behaviour + curation that match the context.

  * *Sports bar TV*: curated channel set, no repeats, light “jump around” behaviour so it feels live-ish and varied. 
  * *Brainbox lectures*: longform-first, fewer jumps, bias toward continuing a thread.
* **No segment repeats / anti-staleness**: don’t loop the same few items endlessly; rotate, come back later, keep the room feeling fresh.
* **Optional “skip filler” heuristics**: crude but useful. Random jump; later, cheap client-side cues (static frames, silence) where feasible in-browser. 

### Backend: curation + enrichment that costs basically nothing

The secret weapon is the same “static builder” pattern you already use for audio: a GitHub Actions pipeline that refreshes feeds, validates them, and generates a deployable site (GitHub Pages) with enriched metadata.

What the Action can do cheaply:

* **Background feed updates**: refresh and cache so the client can always browse *something* even if feeds are slow or flaky. 
* **Video enclosure checks**: mark/disable feeds without working video, or restrict to entries that do have video. 
* **Chapter enrichment**: ingest inline/external chapters, normalize them, and cache a clean representation the client can render quickly. 
* **Theme curation**: group feeds into “themes” (intent-based packs) rather than pretending feed categories are consistent. 

Client behaviour stays flexible:

* Uses your curated/enriched sets by default.
* Can accept user-provided feeds too, just with less enrichment (and still playable/offline-browsable when CORS allows).

### Distribution: multiple deployments, one repo

One codebase, many small landing/app deployments, each with its own config:

* `backgroundtv.app` (generic)
* niche variants (*free-uni-pods*, *church channels*, *tech talks*, etc.)
* market tests without “launching everything” at once

Each deployment is just a config + curated channel set + a static build, so you can experiment cheaply and kill fast.

### Monetisation (optional, later)

Baseline: basically nil, because infra cost is close to zero.
If it’s worth touching:

* light **banner/insert ads** in the UI for generic deployments
* tiny “platform” add-on: **submit your open feed** and we’ll list/show it; pay and you can be injected into certain packs under strict conditions (segmentation, caps, no spam)

### Why it’s viable

You’re not competing with Netflix, YouTube, or “premium video podcasts”. You’re building the thing those platforms don’t bother to: a small, configurable, ambient TV surface that runs on open-ish feeds, survives flakey sources via caching, and can be tailored to weird little audiences without bespoke engineering.
