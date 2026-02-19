// Thin loader so the app can be split into smaller files under `assets/app/`.
// This keeps the HTML template stable while we refactor.
(function () {
  try {
    var cfg = window.__PODCAST_INDEX__ || {};
    var base = String(cfg.basePath || "/");
    if (!base.startsWith("/")) base = "/" + base;
    if (!base.endsWith("/")) base = base + "/";
    var src = base + "assets/app/index.js";
    var s = document.createElement("script");
    s.type = "module";
    s.src = src;
    document.head.appendChild(s);
  } catch (_e) {}
})();

