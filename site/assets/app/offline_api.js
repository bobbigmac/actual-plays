import { initOffline } from "./offline.js";
import { LS_PREFIX, lsGet, lsSet } from "./storage.js";
import { loadQueue } from "./state/queue.js";
import { setAudioCached, setAudioCachedIndex, setOfflineJob, setOfflineStatus } from "./model.js";

function handleOfflineEvent(evt) {
  if (!evt || typeof evt !== "object") return;
  if (evt.type === "status") {
    setOfflineStatus(evt.status || null);
    return;
  }
  if (evt.type === "job") {
    setOfflineJob(evt.url || "", evt.job || null);
    return;
  }
  if (evt.type === "cached") {
    setAudioCached(evt.url || "", Boolean(evt.cached));
    return;
  }
}

export var OFFLINE = initOffline({
  LS_PREFIX: LS_PREFIX,
  lsGet: lsGet,
  lsSet: lsSet,
  loadQueue: loadQueue,
  emit: handleOfflineEvent,
});

export function swRequest(msg) {
  return OFFLINE.swRequest(msg);
}

export function isAudioCached(url) {
  return OFFLINE.isAudioCached(url);
}

export function readOfflineSettings() {
  return OFFLINE.readOfflineSettings();
}

export function writeOfflineSettings(next) {
  return OFFLINE.writeOfflineSettings(next);
}

export function rememberCorsForUrl(url, ok) {
  return OFFLINE.rememberCorsForUrl(url, ok);
}

export function corsOkForUrl(url) {
  return OFFLINE.corsOkForUrl(url);
}

export function refreshOfflineStatus() {
  return OFFLINE.refreshOfflineStatus();
}

export function maybeAutoCacheQueue(opts) {
  return OFFLINE.maybeAutoCacheQueue(opts);
}

export function syncAudioCacheIndex() {
  if (!("caches" in window)) return Promise.resolve(null);
  return window.caches
    .open("ap-audio-v1")
    .then(function (cache) {
      return cache.keys();
    })
    .then(function (keys) {
      var urls = (keys || [])
        .map(function (req) {
          return req && req.url;
        })
        .filter(Boolean);
      setAudioCachedIndex(urls);
      return urls.length;
    })
    .catch(function () {
      return null;
    });
}

export function toggleOfflineUrl(url) {
  var u = String(url || "");
  if (!u) return Promise.reject(new Error("Missing audio URL"));

  setOfflineJob(u, { stage: "active", ts: Date.now(), action: "toggle" });
  return isAudioCached(u)
    .then(function (cached) {
      var act = cached ? "remove" : "cache";
      return swRequest({ type: "ap-media", action: act, url: u }).then(function (res) {
        return { res: res, cached: cached };
      });
    })
    .then(function (x) {
      if (!x || !x.res || !x.res.ok) throw new Error((x && x.res && x.res.error) || "offline cache failed");
      if (typeof x.res.cors === "boolean") rememberCorsForUrl(u, x.res.cors);
      setAudioCached(u, !x.cached);
      return { cached: !x.cached };
    })
    .finally(function () {
      setOfflineJob(u, null);
    });
}
