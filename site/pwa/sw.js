/* Simple offline support for the static site.
   Scope is the site base path (service worker is emitted at /<base>/sw.js). */

const STATIC_CACHE = "ap-static-v2";
const MEDIA_CACHE = "ap-media-v1";

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

function normalizeMediaRequest(req) {
  // Some browsers use Range requests for audio. Cache a "full" request key by dropping headers.
  // We may still respond with the full response to Range requests (not perfect, but works often).
  return new Request(req.url, {
    method: "GET",
    mode: "no-cors",
    credentials: "omit",
    redirect: "follow",
    cache: "no-store",
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll([
          urlFor(""),
          urlFor("index.html"),
          urlFor("search/"),
          urlFor("manifest.webmanifest"),
          urlFor("assets/style.css"),
          urlFor("assets/app.js"),
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
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![STATIC_CACHE, MEDIA_CACHE].includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  if (!msg || msg.type !== "ap-media" || !msg.url) return;

  const req = normalizeMediaRequest(new Request(msg.url));
  const respond = (data) => {
    try {
      port && port.postMessage(data);
    } catch (_e) {}
  };

  if (msg.action === "remove") {
    event.waitUntil(
      caches
        .open(MEDIA_CACHE)
        .then((cache) => cache.delete(req))
        .then(() => respond({ ok: true }))
        .catch((e) => respond({ ok: false, error: String(e || "remove failed") }))
    );
    return;
  }

  if (msg.action === "cache") {
    event.waitUntil(
      caches
        .open(MEDIA_CACHE)
        .then(async (cache) => {
          const existing = await cache.match(req);
          if (existing) return "hit";
          const resp = await fetch(req);
          await cache.put(req, resp.clone());
          trimCache(MEDIA_CACHE, 220);
          return "stored";
        })
        .then((status) => respond({ ok: true, status }))
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
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
            return resp;
          })
          .catch(() => null);
        return cached || network || fetch(req);
      })
    );
    return;
  }

  if (isMedia) {
    const keyReq = normalizeMediaRequest(req);
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(keyReq);

        if (cached) {
          // Stale-while-revalidate for images; cache-first for audio.
          if (isImage) {
            event.waitUntil(
              fetch(keyReq)
                .then((resp) => cache.put(keyReq, resp.clone()))
                .then(() => trimCache(MEDIA_CACHE, 220))
                .catch(() => {})
            );
          }
          return cached;
        }

        try {
          const resp = await fetch(keyReq);
          cache.put(keyReq, resp.clone()).then(() => trimCache(MEDIA_CACHE, 220));
          return resp;
        } catch (_e) {
          return cached || fetch(req);
        }
      })
    );
    return;
  }

  if (isControlledPath) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
