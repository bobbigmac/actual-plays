export function initLazyImages() {
  if (window.__AP_LAZY_IMAGES__) return window.__AP_LAZY_IMAGES__;

  function loadImg(img) {
    if (!img) return;
    var src = img.getAttribute("data-src") || "";
    if (!src) return;
    img.removeAttribute("data-src");
    try {
      img.src = src;
    } catch (_e) {}
  }

  var io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var img = entry.target;
          try {
            io && io.unobserve(img);
          } catch (_e) {}

          var schedule = window.requestIdleCallback || function (fn) { return setTimeout(fn, 0); };
          schedule(function () {
            loadImg(img);
          });
        });
      },
      { root: null, rootMargin: "260px 0px", threshold: 0.01 }
    );
  }

  function refresh(root) {
    var r = root || document;
    var imgs = r.querySelectorAll ? r.querySelectorAll("img[data-src]") : [];
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img || img.getAttribute("data-lazy-bound") === "1") continue;
      img.setAttribute("data-lazy-bound", "1");
      if (io) {
        io.observe(img);
      } else {
        loadImg(img);
      }
    }
  }

  var refreshTimer = null;
  function refreshSoon(root) {
    if (refreshTimer) return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refresh(root);
    }, 50);
  }

  var api = { refresh: refresh, refreshSoon: refreshSoon };
  window.__AP_LAZY_IMAGES__ = api;
  return api;
}

