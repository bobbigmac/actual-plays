export function initOffline(deps) {
  var LS_PREFIX = String((deps && deps.LS_PREFIX) || "ap.v1.");
  var lsGet = (deps && deps.lsGet) || function () { return null; };
  var lsSet = (deps && deps.lsSet) || function () {};
  var loadQueue = (deps && deps.loadQueue) || function () { return []; };

  var CACHE_AUDIO = "ap-audio-v1";
  var OFFLINE_WARN_PCT = 0.8;
  var autoOfflineRunId = 0;

  function swRequest(msg) {
    return new Promise(function (resolve) {
      if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
        resolve({ ok: false, error: "Service worker not active yet (installable PWA; reload once after install)." });
        return;
      }
      try {
        var ch = new MessageChannel();
        ch.port1.onmessage = function (e) {
          resolve((e && e.data) || { ok: false, error: "No response" });
        };
        navigator.serviceWorker.controller.postMessage(msg, [ch.port2]);
      } catch (e) {
        resolve({ ok: false, error: String(e || "SW message failed") });
      }
    });
  }

  function cacheMatch(cacheName, url) {
    if (!("caches" in window)) return Promise.resolve(null);
    if (!url) return Promise.resolve(null);
    return window.caches
      .open(cacheName)
      .then(function (cache) {
        return cache.match(String(url));
      })
      .catch(function () {
        return null;
      });
  }

  function isAudioCached(url) {
    return cacheMatch(CACHE_AUDIO, url).then(function (resp) {
      return Boolean(resp);
    });
  }

  function offlineKey(name) {
    return LS_PREFIX + "offline:" + String(name || "");
  }

  function readOfflineSettings() {
    var auto = lsGet(offlineKey("auto")) === "1";
    var wifiOnly = lsGet(offlineKey("wifiOnly")) === "1";
    var maxEpisodes = Number(lsGet(offlineKey("maxEpisodes")) || "20") || 20;
    maxEpisodes = Math.max(0, Math.min(200, Math.floor(maxEpisodes)));
    return { auto: auto, wifiOnly: wifiOnly, maxEpisodes: maxEpisodes };
  }

  function writeOfflineSettings(next) {
    if (!next || typeof next !== "object") return;
    if ("auto" in next) lsSet(offlineKey("auto"), next.auto ? "1" : "0");
    if ("wifiOnly" in next) lsSet(offlineKey("wifiOnly"), next.wifiOnly ? "1" : "0");
    if ("maxEpisodes" in next) {
      var v = Math.max(0, Math.min(200, Math.floor(Number(next.maxEpisodes) || 0)));
      lsSet(offlineKey("maxEpisodes"), String(v));
    }
  }

  function fmtBytes(bytes) {
    var b = Math.max(0, Number(bytes) || 0);
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
    if (b >= 1024) return Math.round(b / 1024) + " KB";
    return Math.round(b) + " B";
  }

  function getConn() {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }

  function isWifiAllowedBySetting() {
    var s = readOfflineSettings();
    if (!s.wifiOnly) return true;
    var c = getConn();
    if (!c) return true; // can't tell; assume OK
    try {
      if (c.type) return c.type === "wifi" || c.type === "ethernet";
      if (c.saveData === true) return false;
    } catch (_e) {}
    return true;
  }

  function estimateStorage() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage
      .estimate()
      .then(function (e) {
        if (!e) return null;
        var usage = Number(e.usage) || 0;
        var quota = Number(e.quota) || 0;
        var pct = quota > 0 ? usage / quota : 0;
        return { usage: usage, quota: quota, pct: pct };
      })
      .catch(function () {
        return null;
      });
  }

  function corsKey(origin) {
    return LS_PREFIX + "cors:" + encodeURIComponent(String(origin || ""));
  }

  function corsOkForUrl(url) {
    if (!url) return false;
    try {
      var u = new URL(String(url), window.location.href);
      if (u.origin === window.location.origin) return true;
      var raw = lsGet(corsKey(u.origin));
      return raw === "1";
    } catch (_e) {
      return false;
    }
  }

  function rememberCorsForUrl(url, ok) {
    if (!url) return;
    try {
      var u = new URL(String(url), window.location.href);
      if (u.origin === window.location.origin) return;
      lsSet(corsKey(u.origin), ok ? "1" : "0");
    } catch (_e) {}
  }

  function getAudioCacheCount() {
    return swRequest({ type: "ap-media", action: "stats" })
      .then(function (res) {
        if (res && res.ok && typeof res.audioCount === "number") return res.audioCount;
        return window.caches
          .open(CACHE_AUDIO)
          .then(function (c) {
            return c.keys().then(function (keys) {
              return keys.length;
            });
          })
          .catch(function () {
            return 0;
          });
      })
      .catch(function () {
        return 0;
      });
  }

  function refreshOfflineStatus() {
    var status = document.querySelector("#offline-status") || document.querySelector("#data-status");
    if (!status) return Promise.resolve();

    var s = readOfflineSettings();
    var q = loadQueue();
    var queueCount = (q || []).filter(function (it) {
      return it && it.id;
    }).length;

    var swActive = Boolean("serviceWorker" in navigator && navigator.serviceWorker.controller);
    var wifiOk = isWifiAllowedBySetting();

    return Promise.all([estimateStorage(), getAudioCacheCount()]).then(function (arr) {
      var est = arr[0];
      var audioCount = Number(arr[1]) || 0;
      var parts = [];

      parts.push("Offline audio: " + audioCount + " / " + s.maxEpisodes);
      parts.push("Queue: " + queueCount);
      parts.push("Auto: " + (s.auto ? "on" : "off") + (s.wifiOnly ? " (Wi‑Fi only)" : ""));

      if (!wifiOk) parts.push("Waiting for Wi‑Fi");
      if (!swActive) parts.push("SW inactive");

      if (est && est.quota) {
        var pct = Math.round((est.pct || 0) * 100);
        parts.push(
          "Storage: " +
            fmtBytes(est.usage) +
            " / " +
            fmtBytes(est.quota) +
            " (" +
            pct +
            "%, " +
            fmtBytes(Math.max(0, est.quota - est.usage)) +
            " free)"
        );
        if ((est.pct || 0) >= OFFLINE_WARN_PCT) parts.push("near quota (80%)");
      } else if (est) {
        parts.push("Storage: " + fmtBytes(est.usage) + " used");
      } else {
        parts.push("Storage: unavailable");
      }

      status.textContent = parts.join(" · ");
    });
  }

  function maybeAutoCacheQueue(opts) {
    var options = opts || {};
    var s = readOfflineSettings();
    if (!s.auto && !options.force) return refreshOfflineStatus();
    if (!s.maxEpisodes) return refreshOfflineStatus();
    if (!isWifiAllowedBySetting()) return refreshOfflineStatus();

    var runId = ++autoOfflineRunId;

    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
      return refreshOfflineStatus();
    }

    return Promise.all([estimateStorage(), getAudioCacheCount()]).then(function (arr) {
      var est = arr[0];
      var audioCount = Number(arr[1]) || 0;
      if (est && est.quota && (est.pct || 0) >= OFFLINE_WARN_PCT) return refreshOfflineStatus();
      if (audioCount >= s.maxEpisodes) return refreshOfflineStatus();

      var q = loadQueue().slice(0, 200);
      var i = 0;

      function next() {
        if (runId !== autoOfflineRunId) return Promise.resolve();
        if (audioCount >= s.maxEpisodes) return refreshOfflineStatus();
        if (i >= q.length) return refreshOfflineStatus();

        var it = q[i++];
        if (!it || !it.a) return next();

        return isAudioCached(it.a)
          .then(function (cached) {
            if (cached) return "hit";
            return swRequest({ type: "ap-media", action: "cache", url: it.a }).then(function (res) {
              if (!res || !res.ok) return "fail";
              if (typeof res.cors === "boolean") rememberCorsForUrl(it.a, res.cors);
              return res.status || "stored";
            });
          })
          .then(function (status) {
            if (status === "stored") audioCount += 1;
            if (status === "stored" && navigator.storage && navigator.storage.estimate) {
              return estimateStorage().then(function (e2) {
                if (e2 && e2.quota && (e2.pct || 0) >= OFFLINE_WARN_PCT) return refreshOfflineStatus();
                return next();
              });
            }
            return next();
          })
          .catch(function () {
            return next();
          });
      }

      return next();
    });
  }

  return {
    swRequest: swRequest,
    isAudioCached: isAudioCached,
    readOfflineSettings: readOfflineSettings,
    writeOfflineSettings: writeOfflineSettings,
    rememberCorsForUrl: rememberCorsForUrl,
    corsOkForUrl: corsOkForUrl,
    refreshOfflineStatus: refreshOfflineStatus,
    maybeAutoCacheQueue: maybeAutoCacheQueue,
  };
}

