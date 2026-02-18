/* Simple offline support for the static site.
   Scope is the site base path (service worker is emitted at /<base>/sw.js). */

const CACHE = "ap-static-v1";

function urlFor(path) {
  return new URL(path, self.registration.scope).toString();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          urlFor(""),
          urlFor("index.html"),
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);

  if (url.origin !== scope.origin) return;
  if (!url.pathname.startsWith(scope.pathname)) return;

  const isNav = req.mode === "navigate" || (req.destination === "" && req.headers.get("accept")?.includes("text/html"));
  const isAsset = url.pathname.includes("/assets/") || url.pathname.endsWith(".json") || url.pathname.endsWith(".webmanifest");

  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
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
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return resp;
          })
          .catch(() => null);
        return cached || network || fetch(req);
      })
    );
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

