export function getBasePath() {
  var cfg = window.__PODCAST_INDEX__ || {};
  return cfg.basePath || "/";
}

export function getSite() {
  var cfg = window.__PODCAST_INDEX__ || {};
  return cfg.site || {};
}

