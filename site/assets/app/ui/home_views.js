import { $, $all } from "../dom.js";
import { getBasePath } from "../env.js";
import { LS_PREFIX, lsGet, lsSet } from "../storage.js";

var _bound = false;

function isHomePage() {
  var base = new URL(getBasePath(), window.location.origin);
  var p = window.location.pathname;
  return p === base.pathname || p === base.pathname + "index.html";
}

function readViewFromUrl() {
  try {
    var u = new URL(window.location.href);
    return String(u.searchParams.get("view") || "").trim().toLowerCase();
  } catch (_e) {
    return "";
  }
}

function hasViewParam() {
  try {
    var u = new URL(window.location.href);
    return u.searchParams.has("view");
  } catch (_e) {
    return false;
  }
}

function setViewInUrl(view) {
  try {
    var u = new URL(window.location.href);
    u.searchParams.set("view", view);
    window.history.replaceState({}, "", u.pathname + u.search + u.hash);
  } catch (_e) {}
}

export function initHomeViews() {
  if (!isHomePage()) return;

  var key = LS_PREFIX + "homeView";
  var hadParam = hasViewParam();

  function allowedMap() {
    var sections = $all("[data-home-view]");
    var allowed = {};
    sections.forEach(function (s) {
      var v = String(s.getAttribute("data-home-view") || "").trim().toLowerCase();
      if (v) allowed[v] = true;
    });
    return allowed;
  }

  function apply(next, opts) {
    var options = opts || {};
    var allowed = allowedMap();
    var sections = $all("[data-home-view]");
    var buttons = $all("[data-home-view-btn]");
    if (!sections.length) return;

    next = String(next || "").trim().toLowerCase();
    if (!allowed[next]) next = "browse";
    if (!allowed[next]) next = Object.keys(allowed)[0] || "browse";

    sections.forEach(function (s) {
      var v = String(s.getAttribute("data-home-view") || "").trim().toLowerCase();
      s.hidden = v !== next;
    });
    buttons.forEach(function (b) {
      var v = String(b.getAttribute("data-home-view-btn") || "").trim().toLowerCase();
      b.setAttribute("data-active", v === next ? "1" : "0");
    });
    lsSet(key, next);

    // Don't force ?view=browse into the URL unless it's already present
    // or the user explicitly switched views.
    if (options.user || hadParam || next !== "browse") setViewInUrl(next);
  }

  var view = readViewFromUrl() || String(lsGet(key) || "");
  apply(view, { user: false });

  if (!_bound) {
    _bound = true;
    document.addEventListener("click", function (e) {
      var t = e && e.target ? e.target : null;
      if (!t || !t.closest) return;
      var btn = t.closest("[data-home-view-btn]");
      if (!btn) return;
      e.preventDefault();
      apply(btn.getAttribute("data-home-view-btn"), { user: true });
    });
  }
}
