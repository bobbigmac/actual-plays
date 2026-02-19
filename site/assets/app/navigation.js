import { getBasePath } from "./env.js";
import { normalizePathname } from "./util/url.js";

export function initSpaNavigation(deps) {
  var closeData = (deps && deps.closeData) || function () {};
  var closeSearchPanel = (deps && deps.closeSearchPanel) || function () {};
  var onAfterNavigate = (deps && deps.onAfterNavigate) || function () {};
  var onBeforeNavigate = (deps && deps.onBeforeNavigate) || function () {};

  var base = new URL(getBasePath(), window.location.origin);
  var basePathname = normalizePathname(base.pathname);
  var mainSel = "main.wrap";
  var navigating = false;

  function swapMainFromDoc(doc) {
    var nextMain = doc.querySelector(mainSel);
    var curMain = document.querySelector(mainSel);
    if (!nextMain || !curMain) return false;
    curMain.innerHTML = nextMain.innerHTML;
    if (doc.title) document.title = doc.title;
    return true;
  }

  function navigateTo(url, opts) {
    var options = opts || {};
    if (navigating) return;
    navigating = true;

    onBeforeNavigate(url, options);
    var main = document.querySelector(mainSel);
    if (main) main.classList.add("nav-loading");

    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Navigation failed");
        return r.text();
      })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, "text/html");
        if (!swapMainFromDoc(doc)) throw new Error("No <main> found");
        if (!options.pop) {
          window.history.pushState({ spa: true }, "", url);
        }
        closeSearchPanel();
        onAfterNavigate(url, options);
        // Don't auto-switch playback on navigation; deep-link autoplay happens on full load only.
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      })
      .catch(function () {})
      .finally(function () {
        navigating = false;
        var m = document.querySelector(mainSel);
        if (m) m.classList.remove("nav-loading");
      });
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var a = t.closest("a[href]");
    if (!a) return;
    if (a.getAttribute("target") === "_blank") return;
    if (a.hasAttribute("download")) return;

    var href = a.getAttribute("href") || "";
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;

    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (_e) {
      return;
    }
    if (url.origin !== window.location.origin) return;
    if (!normalizePathname(url.pathname).startsWith(basePathname)) return;

    // Allow pure hash changes without fetching.
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
      return;
    }

    e.preventDefault();
    closeData();
    navigateTo(url.pathname + url.search + url.hash, { pop: false });
  });

  window.addEventListener("popstate", function () {
    navigateTo(window.location.pathname + window.location.search + window.location.hash, { pop: true });
  });

  window.__AP_NAV__ = {
    go: navigateTo,
  };
}

