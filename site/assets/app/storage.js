function _normNs(value) {
  var s = String(value || "")
    .trim()
    .toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "default";
}

function _siteNamespace() {
  try {
    var cfg = window.__PODCAST_INDEX__ || {};
    var site = cfg.site || {};
    var base = String(cfg.basePath || "/");
    return _normNs(site.id || site.storage_key || site.storageKey || site.title || base);
  } catch (_e) {
    return "default";
  }
}

// Namespace all localStorage keys per deployment/site so multiple sites can share an origin.
export var LS_PREFIX = "ap.v2." + _siteNamespace() + ".";

export function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_e) {
    return null;
  }
}

export function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_e) {}
}
