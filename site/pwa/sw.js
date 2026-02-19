/* Simple offline support for the static site.
   Scope is the site base path (service worker is emitted at /<base>/sw.js). */

const STATIC_CACHE = "ap-static-v4";
const ART_CACHE = "ap-art-v1";
const AUDIO_CACHE = "ap-audio-v1";
const LEGACY_MEDIA_CACHE = "ap-media-v1";

function urlFor(path) {
  return new URL(path, self.registration.scope).toString();
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const extra = keys.length - maxEntries;
    for (let i = 0; i < extra; i++) {
      await cache.delete(keys[i]);
    }
  } catch (_e) {}
}

function isLikelyAudio(url) {
  return (
    url.pathname.match(/\.(mp3|m4a|aac|ogg|opus|wav)(\?|#|$)/i) ||
    url.pathname.includes("/audio/") ||
    url.pathname.includes("/episodes/")
  );
}

async function migrateLegacyCache() {
  try {
    const keys = await caches.keys();
    if (!keys.includes(LEGACY_MEDIA_CACHE)) return;
    const legacy = await caches.open(LEGACY_MEDIA_CACHE);
    const reqs = await legacy.keys();
    if (!reqs.length) {
      await caches.delete(LEGACY_MEDIA_CACHE);
      return;
    }
    const art = await caches.open(ART_CACHE);
    const audio = await caches.open(AUDIO_CACHE);
    for (const req of reqs) {
      try {
        const resp = await legacy.match(req);
        if (!resp) continue;
        const u = new URL(req.url);
        if (isLikelyAudio(u)) await audio.put(req.url, resp);
        else await art.put(req.url, resp);
      } catch (_e) {}
    }
    await caches.delete(LEGACY_MEDIA_CACHE);
  } catch (_e) {}
}

async function fetchBest(url) {
  // Prefer CORS so WebAudio can work when the host supports it; fallback to no-cors for offline playback.
  try {
    return await fetch(url, { mode: "cors", credentials: "omit", redirect: "follow", cache: "no-store" });
  } catch (_e) {
    return await fetch(url, { mode: "no-cors", credentials: "omit", redirect: "follow", cache: "no-store" });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll([
          urlFor(""),
          urlFor("index.html"),
          urlFor("manifest.webmanifest"),
          urlFor("assets/style.css"),
          urlFor("assets/app.js"),
          urlFor("assets/app/index.js"),
          urlFor("assets/app/home.js"),
          urlFor("assets/app/player.js"),
          urlFor("assets/app/search.js"),
          urlFor("assets/app/episode_actions.js"),
          urlFor("assets/app/dom.js"),
          urlFor("assets/app/env.js"),
          urlFor("assets/app/storage.js"),
          urlFor("assets/app/store.js"),
          urlFor("assets/app/model.js"),
          urlFor("assets/app/offline_api.js"),
          urlFor("assets/app/util/bytes.js"),
          urlFor("assets/app/util/time.js"),
          urlFor("assets/app/util/url.js"),
          urlFor("assets/app/ui/episode_dom.js"),
          urlFor("assets/app/ui/art.js"),
          urlFor("assets/app/ui/lazy_images.js"),
          urlFor("assets/app/ui/header_offset.js"),
          urlFor("assets/app/ui/descriptions.js"),
          urlFor("assets/app/ui/menus.js"),
          urlFor("assets/app/ui/speakers.js"),
          urlFor("assets/app/ui/toast.js"),
          urlFor("assets/app/state/progress.js"),
          urlFor("assets/app/state/history.js"),
          urlFor("assets/app/state/queue.js"),
          urlFor("assets/app/offline.js"),
          urlFor("assets/app/data_panel.js"),
          urlFor("assets/app/pwa.js"),
          urlFor("assets/app/navigation.js"),
          urlFor("assets/app/episode_meta.js"),
          urlFor("assets/icon-192.png"),
          urlFor("assets/icon-512.png"),
          urlFor("assets/apple-touch-icon.png"),
        ])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    migrateLegacyCache()
      .then(() => caches.keys())
      .then((keys) =>
        Promise.all(keys.filter((k) => ![STATIC_CACHE, ART_CACHE, AUDIO_CACHE].includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  const respond = (data) => {
    try {
      port && port.postMessage(data);
    } catch (_e) {}
  };

  if (!msg || msg.type !== "ap-media") return;

  if (msg.action === "stats") {
    event.waitUntil(
      Promise.all([caches.open(AUDIO_CACHE).then((c) => c.keys()), caches.open(ART_CACHE).then((c) => c.keys())])
        .then(([audioKeys, artKeys]) => respond({ ok: true, audioCount: audioKeys.length, artCount: artKeys.length }))
        .catch((e) => respond({ ok: false, error: String(e || "stats failed") }))
    );
    return;
  }

  if (!msg.url) return;

  if (msg.action === "remove") {
    event.waitUntil(
      caches
        .open(AUDIO_CACHE)
        .then((cache) => cache.delete(msg.url))
        .then(() => respond({ ok: true }))
        .catch((e) => respond({ ok: false, error: String(e || "remove failed") }))
    );
    return;
  }

  if (msg.action === "has") {
    event.waitUntil(
      caches
        .open(AUDIO_CACHE)
        .then((cache) => cache.match(msg.url))
        .then((resp) => respond({ ok: true, cached: Boolean(resp), type: resp ? resp.type : "" }))
        .catch((e) => respond({ ok: false, error: String(e || "has failed") }))
    );
    return;
  }

  if (msg.action === "cache") {
    event.waitUntil(
      caches
        .open(AUDIO_CACHE)
        .then(async (cache) => {
          const existing = await cache.match(msg.url);
          if (existing) return { status: "hit", type: existing.type };
          const resp = await fetchBest(msg.url);
          await cache.put(msg.url, resp.clone());
          return { status: "stored", type: resp.type };
        })
        .then((x) => respond({ ok: true, status: x.status, type: x.type, cors: x.type !== "opaque" }))
        .catch((e) => respond({ ok: false, error: String(e || "cache failed") }))
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);

  const isControlledPath = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  const isImage = req.destination === "image";
  const isAudio = req.destination === "audio" || isLikelyAudio(url);
  const isMedia = isImage || isAudio;

  // We only handle cross-origin requests for media runtime caching.
  if (!isControlledPath && !isMedia) return;

  const isNav = isControlledPath && (req.mode === "navigate" || (req.destination === "" && req.headers.get("accept")?.includes("text/html")));
  const isAsset =
    isControlledPath &&
    (url.pathname.includes("/assets/") || url.pathname.endsWith(".json") || url.pathname.endsWith(".webmanifest"));

  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(urlFor("index.html")))
    );
    return;
  }

  if (isAsset) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((cached) => cached || fetch(req)))
    );
    return;
  }

  if (isMedia) {
    event.respondWith(
      (async () => {
        if (isImage) {
          const cache = await caches.open(ART_CACHE);
          const cached = await cache.match(req.url);
          if (cached) {
            event.waitUntil(
              fetch(req)
                .then((resp) => cache.put(req.url, resp.clone()))
                .then(() => trimCache(ART_CACHE, 300))
                .catch(() => {})
            );
            return cached;
          }
          const resp = await fetch(req);
          cache.put(req.url, resp.clone()).then(() => trimCache(ART_CACHE, 300));
          return resp;
        }

        // Audio is cached only when explicitly requested (Offline / auto-queue).
        const cache = await caches.open(AUDIO_CACHE);
        const cached = await cache.match(req.url);
        if (cached) return cached;
        return fetch(req);
      })().catch(() => fetch(req))
    );
    return;
  }

  if (isControlledPath) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
