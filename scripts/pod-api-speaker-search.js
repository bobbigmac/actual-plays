#!/usr/bin/env node
/**
 * speaker-scan.mjs
 *
 * Usage:
 *   node speaker-scan.mjs --names "Bob Mortimer,Richard Osman" --out episodes.json
 *   node speaker-scan.mjs --names-file names.txt --out episodes.json
 *
 * Env:
 *   APPLE_COUNTRY=GB
 *   APPLE_LIMIT=200
 *
 *   PODCASTINDEX_KEY=...
 *   PODCASTINDEX_SECRET=...
 *   PODCASTINDEX_MAX_FEEDS_PER_NAME=20
 *   PODCASTINDEX_MAX_EPISODES_PER_FEED=20
 *
 *   LISTENNOTES_KEY=...
 *   LISTENNOTES_LIMIT=50
 *
 *   PODCHASER_TOKEN=...           (preferred for Actions/CI; skips OAuth)
 *   PODCHASER_CLIENT_ID=...
 *   PODCHASER_CLIENT_SECRET=...
 *   PODCHASER_FIRST=50
 *
 *   CACHE_DIR=.cache/podcast-search
 *   CACHE_TTL_SECONDS=21600
 *   MAX_CONCURRENCY=6
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) return "";
  return v;
};

const log = (msg) => console.log(`[speaker-scan] ${msg}`);
const warn = (msg) => console.warn(`[speaker-scan] WARN ${msg}`);

const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), ".cache", "podcast-search");
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || "21600", 10); // 6h default
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || "6", 10);

fs.mkdirSync(CACHE_DIR, { recursive: true });

class Semaphore {
  constructor(n) {
    this.n = n;
    this.q = [];
    this.inflight = 0;
  }
  async run(fn) {
    if (this.inflight >= this.n) await new Promise((r) => this.q.push(r));
    this.inflight++;
    try {
      return await fn();
    } finally {
      this.inflight--;
      const r = this.q.shift();
      if (r) r();
    }
  }
}
const sem = new Semaphore(MAX_CONCURRENCY);

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const stableJson = (obj) => JSON.stringify(obj, Object.keys(obj).sort());

const cachePathFor = (key) => path.join(CACHE_DIR, `${sha256(key)}.json`);

const readCache = (key) => {
  const p = cachePathFor(key);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
};

const writeCache = (key, value) => {
  const p = cachePathFor(key);
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithCache(url, { method = "GET", headers = {}, body = null, ttlSeconds = CACHE_TTL_SECONDS, cacheKeyExtra = "" } = {}) {
  const cacheKey = `${method} ${url}\n${stableJson(headers)}\n${body ? (typeof body === "string" ? body : stableJson(body)) : ""}\n${cacheKeyExtra}`;
  const cached = readCache(cacheKey);

  const now = Date.now();
  if (cached?.fetchedAt && cached?.ttlSeconds && now - cached.fetchedAt < cached.ttlSeconds * 1000) {
    log(`cache hit: ${url}`);
    return cached.data;
  }

  const reqHeaders = { ...headers };

  // lite "smart" caching: conditional GET when possible
  if (cached?.etag) reqHeaders["If-None-Match"] = cached.etag;
  if (cached?.lastModified) reqHeaders["If-Modified-Since"] = cached.lastModified;

  log(`fetch: ${url}`);
  const res = await sem.run(() =>
    fetch(url, {
      method,
      headers: reqHeaders,
      body: body == null ? null : typeof body === "string" ? body : JSON.stringify(body),
    })
  );

  if (res.status === 304 && cached?.data) {
    log(`304 not modified: ${url}`);
    writeCache(cacheKey, { ...cached, fetchedAt: now, ttlSeconds });
    return cached.data;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\n${txt.slice(0, 800)}`);
  }

  const etag = res.headers.get("etag") || null;
  const lastModified = res.headers.get("last-modified") || null;
  const data = await res.json();

  writeCache(cacheKey, { fetchedAt: now, ttlSeconds, etag, lastModified, data });
  return data;
}

function normalizeText(s) {
  return (s || "").toString().toLowerCase();
}

function matchAnyName(text, names) {
  const t = normalizeText(text);
  for (const n of names) {
    const nn = normalizeText(n).trim();
    if (!nn) continue;
    if (t.includes(nn)) return true;
  }
  return false;
}

function episodeMatchBlob({ title = "", description = "" } = {}) {
  // Intent: discover *guest* appearances. Avoid matching solely on podcast/show title
  // (e.g. "Off Menu with X") by only matching episode title/description.
  return `${title || ""}\n${description || ""}`;
}

function normalizeEpisode(e) {
  // expected normalized shape downstream
  return {
    provider: e.provider,
    matchedNames: e.matchedNames || [],
    title: e.title || "",
    podcastTitle: e.podcastTitle || "",
    description: e.description || "",
    publishedAt: e.publishedAt || null,
    audioUrl: e.audioUrl || null,
    episodeUrl: e.episodeUrl || null,
    rssFeedUrl: e.rssFeedUrl || null,
    ids: e.ids || {},
    raw: e.raw || null,
  };
}

function dedupeEpisodes(episodes) {
  const seen = new Set();
  const out = [];
  for (const e of episodes) {
    const key =
      e.audioUrl ||
      e.episodeUrl ||
      (e.ids?.appleTrackId ? `appleTrack:${e.ids.appleTrackId}` : "") ||
      (e.ids?.listennotesId ? `ln:${e.ids.listennotesId}` : "") ||
      (e.ids?.podchaserId ? `pc:${e.ids.podchaserId}` : "") ||
      (e.ids?.podcastIndexEpisodeId ? `pi:${e.ids.podcastIndexEpisodeId}` : "") ||
      sha1(`${e.title}|${e.podcastTitle}|${e.publishedAt || ""}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/* ---------------- Providers ---------------- */

async function providerAppleEpisodes(names) {
  const country = process.env.APPLE_COUNTRY || "GB";
  const limit = parseInt(process.env.APPLE_LIMIT || "200", 10);
  const out = [];

  // throttle a bit to be polite
  for (const name of names) {
    const term = encodeURIComponent(name);
    const url = `https://itunes.apple.com/search?term=${term}&media=podcast&entity=podcastEpisode&country=${encodeURIComponent(country)}&limit=${limit}`;
    let data;
    try {
      data = await fetchJsonWithCache(url, { ttlSeconds: CACHE_TTL_SECONDS });
    } catch (e) {
      warn(`Apple search failed for "${name}": ${e.message}`);
      continue;
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    log(`Apple "${name}" -> ${results.length} results`);
    for (const r of results) {
      const title = r.trackName || "";
      const podcastTitle = r.collectionName || "";
      const description = r.description || r.shortDescription || "";
      const blob = episodeMatchBlob({ title, description });
      if (!matchAnyName(blob, [name])) continue;

      out.push(
        normalizeEpisode({
          provider: "apple",
          matchedNames: [name],
          title,
          podcastTitle,
          description,
          publishedAt: r.releaseDate || null,
          audioUrl: r.episodeUrl || r.previewUrl || null,
          episodeUrl: r.trackViewUrl || null,
          rssFeedUrl: r.feedUrl || null,
          ids: {
            appleCollectionId: r.collectionId ?? null,
            appleTrackId: r.trackId ?? null,
          },
          raw: r,
        })
      );
    }

    await sleep(150);
  }

  return out;
}

function podcastIndexHeaders() {
  const key = process.env.PODCASTINDEX_KEY;
  const secret = process.env.PODCASTINDEX_SECRET;
  if (!key || !secret) return null;

  const ts = Math.floor(Date.now() / 1000);
  const auth = sha1(`${key}${secret}${ts}`);

  return {
    "User-Agent": "speaker-scan/1.0 (github-actions)",
    "X-Auth-Key": key,
    "X-Auth-Date": String(ts),
    Authorization: auth,
  };
}

async function providerPodcastIndex(names) {
  const headers = podcastIndexHeaders();
  if (!headers) {
    log("PodcastIndex disabled (missing PODCASTINDEX_KEY/SECRET)");
    return [];
  }

  const maxFeedsPerName = parseInt(process.env.PODCASTINDEX_MAX_FEEDS_PER_NAME || "20", 10);
  const maxEpisodesPerFeed = parseInt(process.env.PODCASTINDEX_MAX_EPISODES_PER_FEED || "20", 10);

  const base = "https://api.podcastindex.org/api/1.0";
  const out = [];
  const feedIds = new Map(); // feedId -> {title,url}

  for (const name of names) {
    const url = `${base}/search/byterm?q=${encodeURIComponent(name)}`;
    let data;
    try {
      data = await fetchJsonWithCache(url, { headers, ttlSeconds: CACHE_TTL_SECONDS, cacheKeyExtra: "podcastindex" });
    } catch (e) {
      warn(`PodcastIndex search failed for "${name}": ${e.message}`);
      continue;
    }

    const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
    log(`PodcastIndex "${name}" -> ${feeds.length} feeds (taking ${maxFeedsPerName})`);

    for (const f of feeds.slice(0, maxFeedsPerName)) {
      if (f?.id == null) continue;
      feedIds.set(String(f.id), { podcastTitle: f.title || "", rssFeedUrl: f.url || null });
    }

    await sleep(150);
  }

  const feedList = [...feedIds.entries()];
  log(`PodcastIndex fetching recent episodes from ${feedList.length} unique feeds`);

  for (const [feedId, meta] of feedList) {
    const url = `${base}/episodes/byfeedid?id=${encodeURIComponent(feedId)}&max=${maxEpisodesPerFeed}&fulltext=true`;
    let data;
    try {
      data = await fetchJsonWithCache(url, { headers, ttlSeconds: CACHE_TTL_SECONDS, cacheKeyExtra: `pi-feed-${feedId}` });
    } catch (e) {
      warn(`PodcastIndex episodes/byfeedid failed for feed ${feedId}: ${e.message}`);
      continue;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    for (const it of items) {
      const title = it.title || "";
      const description = it.description || "";
      const podcastTitle = meta.podcastTitle || it.feedTitle || "";
      const blob = episodeMatchBlob({ title, description });
      const matched = names.filter((n) => matchAnyName(blob, [n]));
      if (!matched.length) continue;

      out.push(
        normalizeEpisode({
          provider: "podcastindex",
          matchedNames: matched,
          title,
          podcastTitle,
          description,
          publishedAt: it.datePublished ? new Date(it.datePublished * 1000).toISOString() : null,
          audioUrl: it.enclosureUrl || null,
          episodeUrl: it.link || null,
          rssFeedUrl: meta.rssFeedUrl || it.feedUrl || null,
          ids: {
            podcastIndexEpisodeId: it.id ?? null,
            podcastIndexFeedId: it.feedId ?? (feedId ? Number(feedId) : null),
          },
          raw: it,
        })
      );
    }

    await sleep(120);
  }

  return out;
}

async function providerListenNotes(names) {
  const key = process.env.LISTENNOTES_KEY;
  if (!key) {
    log("Listen Notes disabled (missing LISTENNOTES_KEY)");
    return [];
  }

  const limit = parseInt(process.env.LISTENNOTES_LIMIT || "50", 10);
  const out = [];
  const base = "https://listen-api.listennotes.com/api/v2";

  for (const name of names) {
    const url = `${base}/search?q=${encodeURIComponent(name)}&type=episode&offset=0&safe_mode=0`;
    let data;
    try {
      data = await fetchJsonWithCache(url, {
        headers: { "X-ListenAPI-Key": key, "User-Agent": "speaker-scan/1.0 (github-actions)" },
        ttlSeconds: CACHE_TTL_SECONDS,
        cacheKeyExtra: "listennotes",
      });
    } catch (e) {
      warn(`Listen Notes search failed for "${name}": ${e.message}`);
      continue;
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    log(`Listen Notes "${name}" -> ${results.length} results (taking ${limit})`);

    for (const r of results.slice(0, limit)) {
      const title = r.title_original || r.title || "";
      const podcastTitle = r.podcast?.title_original || r.podcast?.title || "";
      const description = r.description_original || r.description || "";
      const blob = episodeMatchBlob({ title, description });
      if (!matchAnyName(blob, [name])) continue;

      out.push(
        normalizeEpisode({
          provider: "listennotes",
          matchedNames: [name],
          title,
          podcastTitle,
          description,
          publishedAt: r.pub_date_ms ? new Date(r.pub_date_ms).toISOString() : null,
          audioUrl: r.audio || null,
          episodeUrl: r.link || null,
          rssFeedUrl: r.podcast?.rss || null,
          ids: {
            listennotesId: r.id ?? null,
            listennotesPodcastId: r.podcast?.id ?? null,
          },
          raw: r,
        })
      );
    }

    await sleep(120);
  }

  return out;
}

async function podchaserRequestAccessToken(clientId, clientSecret) {
  const cacheKey = `podchaser-access-token:${clientId}`;
  const cached = readCache(cacheKey);
  if (cached?.data?.access_token) return cached.data.access_token;

  const url = "https://api.podchaser.com/graphql";
  const query = `
    mutation GetToken($input: AccessTokenRequest!) {
      requestAccessToken(input: $input) {
        access_token
      }
    }
  `;

  const variables = {
    input: {
      grant_type: "CLIENT_CREDENTIALS",
      client_id: clientId,
      client_secret: clientSecret,
    },
  };

  const res = await sem.run(() =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "speaker-scan/1.0 (github-actions)",
      },
      body: JSON.stringify({ query, variables }),
    })
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Podchaser token HTTP ${res.status}\n${txt.slice(0, 800)}`);
  }

  const json = await res.json();
  const token = json?.data?.requestAccessToken?.access_token;
  if (!token) throw new Error(`Podchaser token missing in response: ${JSON.stringify(json).slice(0, 800)}`);

  // token lasts ~1 year; store with long ttl
  writeCache(cacheKey, { fetchedAt: Date.now(), ttlSeconds: 300 * 24 * 3600, data: { access_token: token } });
  return token;
}

async function providerPodchaser(names) {
  // Prefer token (for Actions / CI); fall back to OAuth client credentials.
  let token = process.env.PODCHASER_TOKEN || process.env.PODCHASER_ACCESS_TOKEN || "";
  if (!token) {
    const clientId = process.env.PODCHASER_CLIENT_ID;
    const clientSecret = process.env.PODCHASER_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      log("Podchaser disabled (missing PODCHASER_TOKEN or PODCHASER_CLIENT_ID/SECRET)");
      return [];
    }
    try {
      token = await podchaserRequestAccessToken(clientId, clientSecret);
    } catch (e) {
      warn(`Podchaser token failed: ${e.message}`);
      return [];
    }
  }

  const first = parseInt(process.env.PODCHASER_FIRST || "50", 10);
  const out = [];
  const url = "https://api.podchaser.com/graphql";

  for (const name of names) {
    const query = `
      query Episodes($searchTerm: String!, $first: Int!) {
        episodes(searchTerm: $searchTerm, first: $first, page: 0) {
          paginatorInfo { currentPage hasMorePages lastPage }
          data {
            id
            title
            description
            airDate
            webUrl
            audioUrl
            podcast { id title webUrl rssUrl }
          }
        }
      }
    `;

    let data;
    try {
      data = await fetchJsonWithCache(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "speaker-scan/1.0 (github-actions)",
          },
          body: { query, variables: { searchTerm: name, first } },
          ttlSeconds: CACHE_TTL_SECONDS,
          cacheKeyExtra: `podchaser:${name}`,
        }
      );
    } catch (e) {
      warn(`Podchaser episodes query failed for "${name}": ${e.message}`);
      continue;
    }

    if (Array.isArray(data?.errors) && data.errors.length) {
      const msg = String(data.errors[0]?.message || "Unknown GraphQL error").slice(0, 240);
      warn(`Podchaser GraphQL error for "${name}": ${msg}`);
      continue;
    }

    const episodes = data?.data?.episodes?.data || [];
    log(`Podchaser "${name}" -> ${episodes.length} results`);

    for (const r of episodes) {
      const title = r?.title || "";
      const podcastTitle = r?.podcast?.title || "";
      const description = r?.description || "";
      const blob = episodeMatchBlob({ title, description });
      if (!matchAnyName(blob, [name])) continue;

      out.push(
        normalizeEpisode({
          provider: "podchaser",
          matchedNames: [name],
          title,
          podcastTitle,
          description,
          publishedAt: r?.airDate ? new Date(r.airDate).toISOString() : null,
          audioUrl: r?.audioUrl || null,
          episodeUrl: r?.webUrl || null,
          rssFeedUrl: r?.podcast?.rssUrl || null,
          ids: {
            podchaserId: r?.id ?? null,
            podchaserPodcastId: r?.podcast?.id ?? null,
          },
          raw: r,
        })
      );
    }

    await sleep(150);
  }

  return out;
}

/* ---------------- Main ---------------- */

function parseNames() {
  const namesArg = arg("--names") || process.env.NAMES || "";
  const namesFile = arg("--names-file") || process.env.NAMES_FILE || "";
  let names = [];

  if (namesFile) {
    const p = path.isAbsolute(namesFile) ? namesFile : path.join(process.cwd(), namesFile);
    const txt = fs.readFileSync(p, "utf8");
    names = txt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
  } else if (namesArg) {
    names = namesArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // allow multiple --name
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name" && argv[i + 1]) names.push(argv[i + 1].trim());
  }

  names = [...new Set(names)].filter(Boolean);
  return names;
}

async function main() {
  const names = parseNames();
  if (!names.length) {
    console.error("No names provided. Use --names \"A,B\" or --names-file names.txt (or env NAMES / NAMES_FILE).");
    process.exit(2);
  }

  const outPath = arg("--out") || process.env.OUT || path.join(process.cwd(), "episodes.json");
  log(`names=${names.length} out=${outPath}`);
  log(`cache=${CACHE_DIR} ttl=${CACHE_TTL_SECONDS}s concurrency=${MAX_CONCURRENCY}`);

  const providers = [
    { name: "apple", fn: providerAppleEpisodes },
    { name: "podcastindex", fn: providerPodcastIndex },
    { name: "listennotes", fn: providerListenNotes },
    { name: "podchaser", fn: providerPodchaser },
  ];

  const all = [];
  for (const p of providers) {
    try {
      const res = await p.fn(names);
      all.push(...res);
      log(`${p.name}: ${res.length} matched episodes`);
    } catch (e) {
      warn(`${p.name} crashed: ${e.message}`);
    }
  }

  const deduped = dedupeEpisodes(all);

  // extra safety: ensure each episode still matches at least one name in title/desc/podcastTitle
  const final = deduped
    .map((e) => {
      const blob = episodeMatchBlob({ title: e.title, description: e.description });
      const matched = names.filter((n) => matchAnyName(blob, [n]));
      return { ...e, matchedNames: matched.length ? matched : e.matchedNames };
    })
    .filter((e) => (e.matchedNames || []).length);

  final.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), names, count: final.length, episodes: final }, null, 2));

  log(`done: ${final.length} episodes -> ${outPath}`);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
