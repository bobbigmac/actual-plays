# Client-side Podcast Index on GitHub Pages

This repo hosts a podcast browser that runs entirely in the user’s web browser. GitHub Actions periodically fetches a configured set of RSS feeds, updates a lightweight cached representation, and rebuilds static HTML for GitHub Pages. There’s no server, no API, no remote processing at runtime.

The UI behaves like it has per-episode pages, but we don’t generate them. We render one page per podcast feed (plus optional speaker/topic pages), and the client routes between “views” by reading embedded metadata and passing parameters (including “skip to” episode) when linking across podcasts.

## Goals

* All runtime logic is client-side in the browser.
* All ingestion + tagging happens in GitHub Actions.
* Output is static HTML (served by GitHub Pages as a CDN).
* Minimal repo noise: avoid exploding file counts (no per-episode pages).
* Extract just enough structure (speakers/topics/flags) to enable:

  * “more with this speaker” recommendations across podcasts
  * topic-ish clustering and filtering
  * a basic search index that ignores filler/grammar words

## Non-goals

* No server-side backend, no hosted database.
* No complex parsing pipelines or brittle schema-heavy systems.
* No “perfect” NLP. We accept that extraction is inconsistent; text search remains the fallback.
* No permanent, user-facing invented IDs. We only derive internal keys for dedupe/change detection.

## High-level architecture

1. **Config**: a small list of RSS feeds in the repo.
2. **Updater Action**:

   * fetches each feed on a tunable schedule (to avoid hammering)
   * detects changes since last run
   * updates the cached markdown for only the feeds that changed
   * regenerates HTML and a small JSON search index
   * pushes updates to the Pages branch
3. **Client UI**:

   * loads podcast pages (HTML) and reads `data-*` / embedded JSON blobs
   * routes internally to show “episode view” without needing dedicated pages
   * lazily loads the search index JSON when needed

## Data storage: “retagged feed” markdown

Each podcast feed has one canonical cache file, updated in-place. This keeps diffs readable and avoids generating thousands of small files.

* One markdown file per feed
* Contains:

  * feed metadata (URL, title, last checked, etag/last-modified if available)
  * episodes as a simple list/sections (ordered by publish date)
  * original description text (kept so tagging can be re-run later if heuristics change)
  * detected tags:

    * speakers (names)
    * topics/themes (noun-ish terms/phrases)
    * small flags (e.g. “interview”, “live”, “trailer”)
    * confidence (optional)

We keep this format tolerant: if something fails to parse or extract, the cache still updates and the site still builds.

## Avoiding fabricated IDs

Public site content doesn’t rely on invented IDs.

* Episode identity for dedupe/change detection is derived from what RSS already gives us:

  * `guid` if present
  * else `enclosure.url`
  * else (title + pubDate) as a fallback
* Internally we can derive a stable key from those fields for comparisons, but we don’t expose it as a primary concept and we don’t litter pages with it unless it’s convenient for client navigation.

## HTML output: per-podcast pages only

We generate:

* one page per podcast feed (the main browsing surface)
* optional aggregate pages:

  * speaker pages (listing episodes across feeds where a speaker is detected)
  * topic pages (same idea)
* a JSON index for search and lightweight recommendation lookup

We do not generate per-episode pages. The UI can render an “episode view” by pulling the episode metadata from the podcast page data and updating the browser history state.

### Data in HTML

Each podcast page includes its episode metadata in a machine-readable form that the UI can consume without scraping.

Typical approaches (pick one):

* a `<script type="application/json" id="feed-data">…</script>` blob
* `data-*` fields on episode elements for quick access

The important part is: the UI can jump directly to an episode, highlight it, and play it, without needing a distinct URL per episode.

## Search + lightweight indexing

Search is a lazily-loaded JSON file generated during the build.

* The index contains only what the client needs:

  * episode title
  * publish date
  * feed reference (slug / url)
  * extracted speakers/topics/flags (tokenized/normalized)
  * the page URL + enough info to jump to the episode in-page
* We do not ship full descriptions into the index.
* Tokenization aims to drop filler and grammatical words so the search remains useful even with noisy extraction.

The index can grow to ~1MB without being a problem if it’s fetched only when the user opens search.

## Recommendations

Primary recs are speaker-driven:

* On an episode view, the UI picks the most salient detected speaker(s) and recommends:

  * other episodes (across all feeds) that contain that speaker
  * if we can infer a “speaker’s own podcast” (weak heuristics), promote that feed

We don’t hard-separate “guest” vs “host”. If a person appears as a speaker, that’s enough; role is an attribute if we can infer it, not a distinct class.

Fallback recs:

* topic overlap
* simple “more from this feed” / “recent in group” lists when extraction is weak

## NLP: “good enough” extraction

We keep the NLP minimal and replaceable.

Baseline plan:

* Normalize text (strip HTML, collapse whitespace)
* Extract candidate people names and noun-ish terms
* Apply simple filtering to reduce junk:

  * drop stopwords and very short tokens
  * prefer title/lead paragraph terms
  * de-duplicate by normalized form

Library choice:

* Start with something like `compromise` for light NER-ish extraction.
* Evaluate results on real feed samples before adding complexity.
* If compromise is too noisy, we keep rules simple rather than building a heavy parser stack.

Reliability stance:

* It’s OK if some episodes don’t get good speakers/topics.
* The whole group is roughly equally unreliable.
* Search still works because the index includes titles and normalized tag tokens.

## Update cadence / balancer

We avoid constant firing and avoid spamming feed hosts.

Mechanics:

* Maintain a small state file (per feed: last check time and caching headers)
* Use conditional GET (`If-None-Match` / `If-Modified-Since`) where possible
* Apply a tunable schedule policy so hot feeds can be checked more often than slow ones

This keeps Action runtime predictable and fits within normal GitHub Pages usage.

## Implementation outline

* `feeds.yaml`: configured RSS URLs + optional scheduling hints
* `cache/feeds/*.md`: one markdown cache per feed (retagged representation)
* `cache/state.json`: last checked + etag/last-modified + cooldown bookkeeping
  - Cache/data should probably be on a branch, on the action step, not sure if/how that works
* `scripts/update-feeds.mjs`:
  * fetch, diff, update cache markdown
  * run tagging on new/changed episodes, index and connect/graph links
* `scripts/ingest-podcast.mjs`:
  * Build the html pages from the markdown
* `scripts/build-html.mjs`:

  * render podcast pages from cached markdown
  * optionally render speaker/topic aggregate pages
  * emit `site/index.json` for search/recs

* GitHub Action:
  * scheduled + manual trigger
  * run update script
  * if repo changed, run build and push to Pages branch

## Future ideas (deliberately not in scope now)

* Time-based segmentation (e.g. per scene/discussion) with extra server processor (and better data source).
* More nuanced cadence prediction for fetch prioritization.
* Moving heavy indexing off GitHub Pages if performance demands it later.

## Why this design stays light

* No per-episode pages, so file count stays small.
* Cached markdown stays human-readable and patchable.
* Minimal derived identifiers, minimal schema commitments.
* Tagging is “good enough” and replaceable without migrating a database.
* Static pages + JSON index scale comfortably at the “dozens of feeds” level.
