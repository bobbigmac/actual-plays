import { initOffline } from "./offline.js";
import { initDataPanel } from "./data_panel.js";

(function () {
  function getBasePath() {
    var cfg = window.__PODCAST_INDEX__ || {};
    return cfg.basePath || "/";
  }

  function getSite() {
    var cfg = window.__PODCAST_INDEX__ || {};
    return cfg.site || {};
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function esc(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function qs(name) {
    var url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function setQs(name, value) {
    var url = new URL(window.location.href);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
    window.history.replaceState({}, "", url.toString());
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return "\\" + c;
    });
  }

  function fmtTime(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    return m + ":" + String(ss).padStart(2, "0");
  }

  var LS_PREFIX = "ap.v1.";
  var OFFLINE = null;
  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_e) {}
  }

  // Offline/caching is implemented in a separate module; these wrappers keep the rest of the code stable.
  function swRequest(msg) {
    if (!OFFLINE) return Promise.resolve({ ok: false, error: "Offline module not ready" });
    return OFFLINE.swRequest(msg);
  }
  function isAudioCached(url) {
    if (!OFFLINE) return Promise.resolve(false);
    return OFFLINE.isAudioCached(url);
  }
  function readOfflineSettings() {
    if (!OFFLINE) return { auto: false, wifiOnly: false, maxEpisodes: 0 };
    return OFFLINE.readOfflineSettings();
  }
  function writeOfflineSettings(next) {
    if (!OFFLINE) return;
    OFFLINE.writeOfflineSettings(next);
  }
  function corsOkForUrl(url) {
    if (!OFFLINE) return false;
    return OFFLINE.corsOkForUrl(url);
  }
  function rememberCorsForUrl(url, ok) {
    if (!OFFLINE) return;
    OFFLINE.rememberCorsForUrl(url, ok);
  }
  function refreshOfflineStatus() {
    if (!OFFLINE) return Promise.resolve();
    return OFFLINE.refreshOfflineStatus();
  }
  function maybeAutoCacheQueue(opts) {
    if (!OFFLINE) return Promise.resolve();
    return OFFLINE.maybeAutoCacheQueue(opts);
  }

  function progressKey(episodeId) {
    return LS_PREFIX + "p:" + episodeId;
  }

  function readProgress(episodeId) {
    var raw = lsGet(progressKey(episodeId));
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return {
        p: Number(obj.p) || 0,
        d: Number(obj.d) || 0,
        u: Number(obj.u) || 0,
        c: Boolean(obj.c),
      };
    } catch (_e) {
      return null;
    }
  }

  function writeProgress(episodeId, p, d, c) {
    var payload = {
      p: Math.max(0, Math.floor(Number(p) || 0)),
      d: Math.max(0, Math.floor(Number(d) || 0)),
      u: Date.now(),
      c: Boolean(c),
    };
    lsSet(progressKey(episodeId), JSON.stringify(payload));
  }

  function writeProgressObj(episodeId, obj) {
    if (!episodeId) return;
    if (!obj || typeof obj !== "object") return;
    var payload = {
      p: Math.max(0, Math.floor(Number(obj.p) || 0)),
      d: Math.max(0, Math.floor(Number(obj.d) || 0)),
      u: Math.max(0, Math.floor(Number(obj.u) || 0)),
      c: Boolean(obj.c),
    };
    if (!payload.u) payload.u = Date.now();
    lsSet(progressKey(episodeId), JSON.stringify(payload));
  }

  function computeProgressUi(progress) {
    if (!progress) return { pct: 0, text: "" };
    if (progress.c) return { pct: 100, text: "Done" };
    if (progress.d > 0 && progress.p > 0) {
      var pct = Math.max(0, Math.min(100, Math.floor((progress.p / progress.d) * 100)));
      return { pct: pct, text: fmtTime(progress.p) + " / " + fmtTime(progress.d) };
    }
    if (progress.p > 0) return { pct: 0, text: fmtTime(progress.p) };
    return { pct: 0, text: "" };
  }

  function updateProgressElement(el) {
    var id = el && el.getAttribute ? el.getAttribute("data-episode-id") : null;
    if (!id) return;
    var progress = readProgress(id);
    var ui = computeProgressUi(progress);
    var bar = el.querySelector ? el.querySelector("[data-progress-bar]") : null;
    var text = el.querySelector ? el.querySelector("[data-progress-text]") : null;
    if (bar) bar.style.width = ui.pct + "%";
    if (text) text.textContent = ui.text;
  }

  function refreshPlayedButtonForElement(el) {
    if (!el || !el.getAttribute) return;
    var id = el.getAttribute("data-episode-id") || "";
    if (!id) return;
    var btn = el.querySelector ? el.querySelector('[data-action="played"]') : null;
    if (!btn) return;
    var p = readProgress(id);
    var done = Boolean(p && p.c);
    btn.textContent = done ? "Mark unplayed" : "Mark played";
  }

  function refreshAllProgress() {
    $all("[data-episode-id]").forEach(function (el) {
      updateProgressElement(el);
      refreshPlayedButtonForElement(el);
    });
  }

  function refreshProgressForId(episodeId) {
    var sel = '[data-episode-id="' + cssEscape(episodeId) + '"]';
    $all(sel).forEach(function (el) {
      updateProgressElement(el);
      refreshPlayedButtonForElement(el);
    });
  }

  function historyKey() {
    return LS_PREFIX + "history";
  }

  function loadHistory() {
    var raw = lsGet(historyKey());
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (_e) {
      return [];
    }
  }

  function saveHistory(items) {
    lsSet(historyKey(), JSON.stringify(items.slice(0, 200)));
  }

  function pushHistoryEntry(entry) {
    var items = loadHistory();
    var next = [];
    var seen = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.id === entry.id) {
        if (!seen) {
          next.push(entry);
          seen = true;
        }
      } else {
        next.push(it);
      }
    }
    if (!seen) next.unshift(entry);
    saveHistory(next);
  }

  function removeFromHistory(episodeId) {
    var items = loadHistory();
    var next = items.filter(function (it) {
      return it && it.id !== episodeId;
    });
    saveHistory(next);
  }

  function queueKey() {
    return LS_PREFIX + "queue";
  }

  var queueSet = null;
  function getQueueSet() {
    if (queueSet) return queueSet;
    var q = loadQueue();
    queueSet = new Set(
      q
        .map(function (it) {
          return it && it.id;
        })
        .filter(Boolean)
    );
    return queueSet;
  }

  function isQueuedId(episodeId) {
    if (!episodeId) return false;
    return getQueueSet().has(episodeId);
  }

  function refreshQueueIndicators() {
    // Rebuild set from storage to keep it truthful after imports/storage events.
    queueSet = null;
    var set = getQueueSet();

    $all("[data-episode-id]").forEach(function (row) {
      var id = row.getAttribute("data-episode-id") || "";
      if (!id) return;
      row.classList.toggle("is-queued", set.has(id));
    });

    $all('[data-action="queue"]').forEach(function (btn) {
      var row = btn.closest ? btn.closest("[data-episode-id]") : null;
      var id = row ? row.getAttribute("data-episode-id") : "";
      var queued = id ? set.has(id) : false;
      btn.classList.toggle("queued", queued);
      btn.setAttribute("aria-pressed", queued ? "true" : "false");
      btn.textContent = "Queue";
    });
  }

  function loadQueue() {
    var raw = lsGet(queueKey());
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (_e) {
      return [];
    }
  }

  function saveQueue(items) {
    lsSet(queueKey(), JSON.stringify(items.slice(0, 200)));
    queueSet = null;
  }

  function enqueue(entry) {
    if (!entry || !entry.id) return;
    var q = loadQueue();
    for (var i = 0; i < q.length; i++) {
      if (q[i] && q[i].id === entry.id) return;
    }
    q.push(entry);
    saveQueue(q);
  }

  function dequeueNext() {
    var q = loadQueue();
    if (!q.length) return null;
    var next = q.shift();
    saveQueue(q);
    return next;
  }

  function removeFromQueue(episodeId) {
    var q = loadQueue();
    var next = q.filter(function (it) {
      return it && it.id !== episodeId;
    });
    saveQueue(next);
  }

  function parseEpisodeId(episodeId) {
    var parts = String(episodeId || "").split(":");
    return { feedSlug: parts[0] || "", episodeKey: parts.slice(1).join(":") || "" };
  }

  // Now that queue storage exists, bind the offline helper module.
  OFFLINE = initOffline({ LS_PREFIX: LS_PREFIX, lsGet: lsGet, lsSet: lsSet, loadQueue: loadQueue });

  var episodeMetaCache = new Map();

  function readEpisodeMetaFromElement(el) {
    if (!el || !el.getAttribute) return null;
    var id = el.getAttribute("data-episode-id") || "";
    if (!id) return null;
    var feedSlug = el.getAttribute("data-feed-slug") || parseEpisodeId(id).feedSlug;
    var episodeKey = el.getAttribute("data-episode-key") || parseEpisodeId(id).episodeKey;
    var title = el.getAttribute("data-episode-title") || "";
    var date = el.getAttribute("data-episode-date") || "";
    var feedTitle = el.getAttribute("data-feed-title") || "";
    var audio = el.getAttribute("data-episode-audio") || "";
    var link = el.getAttribute("data-episode-link") || "";
    var image = el.getAttribute("data-episode-image") || "";
    return {
      id: id,
      feedSlug: feedSlug,
      episodeKey: episodeKey,
      t: title,
      d: date,
      ft: feedTitle,
      a: audio,
      l: link,
      im: image,
    };
  }

  function fetchEpisodeMeta(feedSlug, episodeKey) {
    var url = getBasePath() + "podcasts/" + encodeURIComponent(feedSlug) + "/index.html";
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Failed to load " + url);
        return r.text();
      })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, "text/html");
        var li = doc.querySelector("#e-" + cssEscape(episodeKey));
        if (!li) throw new Error("Episode not found");
        var id = feedSlug + ":" + episodeKey;
        return {
          id: id,
          feedSlug: feedSlug,
          episodeKey: episodeKey,
          t: li.getAttribute("data-episode-title") || "",
          d: li.getAttribute("data-episode-date") || "",
          ft: (doc.querySelector("h1") && doc.querySelector("h1").textContent) || feedSlug,
          a: li.getAttribute("data-episode-audio") || "",
          l: li.getAttribute("data-episode-link") || "",
          im: li.getAttribute("data-episode-image") || "",
        };
      });
  }

  function resolveEpisodeMeta(hint) {
    var meta = hint || {};
    if (!meta.id) return Promise.reject(new Error("Missing episode id"));
    if (meta.a) return Promise.resolve(meta);
    if (episodeMetaCache.has(meta.id)) return Promise.resolve(episodeMetaCache.get(meta.id));

    var parsed = parseEpisodeId(meta.id);
    var feedSlug = meta.feedSlug || parsed.feedSlug;
    var episodeKey = meta.episodeKey || parsed.episodeKey;
    if (!feedSlug || !episodeKey) return Promise.reject(new Error("Missing feed/key"));

    return fetchEpisodeMeta(feedSlug, episodeKey).then(function (full) {
      var merged = {
        id: meta.id,
        feedSlug: full.feedSlug,
        episodeKey: full.episodeKey,
        t: meta.t || full.t,
        d: meta.d || full.d,
        ft: meta.ft || full.ft,
        a: meta.a || full.a,
        l: meta.l || full.l,
        im: meta.im || full.im,
      };
      episodeMetaCache.set(meta.id, merged);
      return merged;
    });
  }

  function isHomePage() {
    var base = new URL(getBasePath(), window.location.origin);
    var p = window.location.pathname;
    return p === base.pathname || p === base.pathname + "index.html";
  }

  function hueFromSeed(seed) {
    var s = String(seed || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 160 + (Math.abs(h) % 180);
  }

  function initialsFromText(text) {
    var parts = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    var out = parts
      .map(function (p) {
        return (p[0] || "").toUpperCase();
      })
      .join("");
    return out.slice(0, 2) || "P";
  }

  function artHtml(imageUrl, seedText) {
    var img = String(imageUrl || "").trim();
    if (img) return '<img src="' + esc(img) + '" alt="" loading="lazy" />';
    var hue = hueFromSeed(seedText);
    return '<div class="cover-fallback" style="--cover-hue: ' + hue + '">' + esc(initialsFromText(seedText)) + "</div>";
  }

  function renderHomePanels() {
    if (!isHomePage()) return;
    var historyList = $("[data-history-list]");
    var historyEmpty = $("#home-history [data-empty]");
    var queueList = $("[data-queue-list]");
    var queueEmpty = $("#home-queue [data-empty]");
    var latestList = $("[data-latest-list]");
    if (!historyList || !queueList || !latestList) return;

    var basePath = getBasePath();

    // History
    var hist = loadHistory();
    var visible = [];
    for (var i = 0; i < hist.length; i++) {
      var it = hist[i];
      if (!it || !it.id) continue;
      var prog = readProgress(it.id);
      if (prog && prog.c) continue;
      visible.push(it);
      if (visible.length >= 25) break;
    }

    // Sort: in-progress first, then most-recently played.
    visible.sort(function (a, b) {
      var pa = readProgress(a.id) || {};
      var pb = readProgress(b.id) || {};
      var wa = pa.p > 0 ? 0 : 1;
      var wb = pb.p > 0 ? 0 : 1;
      if (wa !== wb) return wa - wb;
      return (Number(b.u) || 0) - (Number(a.u) || 0);
    });

    historyList.innerHTML = visible
      .map(function (it) {
        var parsed = parseEpisodeId(it.id);
        var url =
          basePath +
          "podcasts/" +
          encodeURIComponent(parsed.feedSlug) +
          "/?e=" +
          encodeURIComponent(parsed.episodeKey);
        var meta = (it.ft ? esc(it.ft) + " · " : "") + (it.d ? esc(it.d) : "");
        var seed = it.ft || parsed.feedSlug;
        return (
          '<li class="episode-row" data-episode-id="' +
          esc(it.id) +
          '" data-feed-slug="' +
          esc(parsed.feedSlug) +
          '" data-episode-key="' +
          esc(parsed.episodeKey) +
          '" data-episode-title="' +
          esc(it.t || "") +
          '" data-episode-date="' +
          esc(it.d || "") +
          '" data-feed-title="' +
          esc(it.ft || "") +
          '" data-episode-audio="' +
          esc(it.a || "") +
          '" data-episode-link="' +
          esc(it.l || "") +
          '" data-episode-image="' +
          esc(it.im || "") +
          '">' +
          '<div class="row-main">' +
          '<div class="row-head"><span class="row-art">' +
          artHtml(it.im, seed) +
          '</span><div class="row-text"><a href="' +
          esc(url) +
          '">' +
          esc(it.t || "") +
          "</a>" +
          (meta ? '<span class="muted">(' + meta + ")</span>" : "") +
          "</div></div>" +
          "</div>" +
          '<div class="row-actions">' +
          '<button class="btn-primary btn-sm" type="button" data-action="play">Resume</button>' +
          '<button class="btn btn-sm queue-btn" type="button" data-action="queue">Queue</button>' +
          '<details class="menu">' +
          '  <summary class="btn btn-sm" aria-label="More actions">⋯</summary>' +
          '  <div class="menu-panel card">' +
            '    <button class="btn btn-sm" type="button" data-action="played">Mark played</button>' +
            '    <button class="btn btn-sm" type="button" data-action="offline">Offline</button>' +
          "  </div>" +
          "</details>" +
          "</div>" +
          '<div class="mini-progress"><div class="mini-progress-bar" data-progress-bar></div></div>' +
          '<div class="mini-progress-text muted" data-progress-text></div>' +
          "</li>"
        );
      })
      .join("");
    if (historyEmpty) historyEmpty.style.display = visible.length ? "none" : "";

    // Queue
    var q = loadQueue();
    queueList.innerHTML = q
      .slice(0, 50)
      .map(function (it) {
        if (!it || !it.id) return "";
        var parsed = parseEpisodeId(it.id);
        var url =
          basePath +
          "podcasts/" +
          encodeURIComponent(parsed.feedSlug) +
          "/?e=" +
          encodeURIComponent(parsed.episodeKey);
        var meta = (it.ft ? esc(it.ft) + " · " : "") + (it.d ? esc(it.d) : "");
        var seed = it.ft || parsed.feedSlug;
        return (
          '<li class="episode-row" data-episode-id="' +
          esc(it.id) +
          '" data-feed-slug="' +
          esc(parsed.feedSlug) +
          '" data-episode-key="' +
          esc(parsed.episodeKey) +
          '" data-episode-title="' +
          esc(it.t || "") +
          '" data-episode-date="' +
          esc(it.d || "") +
          '" data-feed-title="' +
          esc(it.ft || "") +
          '" data-episode-audio="' +
          esc(it.a || "") +
          '" data-episode-link="' +
          esc(it.l || "") +
          '" data-episode-image="' +
          esc(it.im || "") +
          '">' +
          '<div class="row-main">' +
          '<div class="row-head"><span class="row-art">' +
          artHtml(it.im, seed) +
          '</span><div class="row-text"><a href="' +
          esc(url) +
          '">' +
          esc(it.t || "") +
          "</a>" +
          (meta ? '<span class="muted">(' + meta + ")</span>" : "") +
          "</div></div>" +
          "</div>" +
          '<div class="row-actions">' +
          '<button class="btn-primary btn-sm" type="button" data-action="play">Play</button>' +
          '<button class="btn btn-sm queue-btn queued" type="button" data-action="queue">Queue</button>' +
          '<details class="menu">' +
          '  <summary class="btn btn-sm" aria-label="More actions">⋯</summary>' +
          '  <div class="menu-panel card">' +
            '    <button class="btn btn-sm" type="button" data-action="played">Mark played</button>' +
            '    <button class="btn btn-sm" type="button" data-action="offline">Offline</button>' +
          "  </div>" +
          "</details>" +
          "</div>" +
          "</li>"
        );
      })
      .join("");
    if (queueEmpty) queueEmpty.style.display = q.length ? "none" : "";

    // Latest: reorder/hide completed.
    var items = $all(".episode-row", latestList);
    items.forEach(function (el) {
      var id = el.getAttribute("data-episode-id") || "";
      var prog = id ? readProgress(id) : null;
      if (prog && prog.c) el.classList.add("is-done");
      else el.classList.remove("is-done");
    });
    items.sort(function (a, b) {
      var ida = a.getAttribute("data-episode-id") || "";
      var idb = b.getAttribute("data-episode-id") || "";
      var pa = readProgress(ida) || {};
      var pb = readProgress(idb) || {};
      var wa = pa.c ? 2 : pa.p > 0 ? 0 : 1;
      var wb = pb.c ? 2 : pb.p > 0 ? 0 : 1;
      if (wa !== wb) return wa - wb;
      var da = a.getAttribute("data-episode-date") || "";
      var db = b.getAttribute("data-episode-date") || "";
      if (da !== db) return db.localeCompare(da);
      return idb.localeCompare(ida);
    });
    items.forEach(function (el) {
      latestList.appendChild(el);
    });

    refreshAllProgress();
    refreshQueueIndicators();
  }

  function initPlayer() {
    var player = $("#player");
    if (!player) return;

    var btnPlayPause = $("#btn-playpause");
    var btnBack15 = $("#btn-back15");
    var btnFwd30 = $("#btn-fwd30");
    var btnSlower = $("#btn-slower");
    var btnFaster = $("#btn-faster");
    var speedReadout = $("#speed-readout");
    var scrub = $("#scrub");
    var tElapsed = $("#t-elapsed");
    var tDuration = $("#t-duration");
    var preservePitch = $("#preserve-pitch");
    var audioNote = $("#audio-note");
    var gain = $("#gain");
    var gainVal = $("#gain-val");
    var eqLow = $("#eq-low");
    var eqMid = $("#eq-mid");
    var eqHigh = $("#eq-high");
    var eqLowVal = $("#eq-low-val");
    var eqMidVal = $("#eq-mid-val");
    var eqHighVal = $("#eq-high-val");

    var currentEpisodeId = null;
    var lastSavedPos = 0;
    var lastSaveMs = 0;
    var saveTimer = null;
    var scrubbing = false;
    var pendingSeek = null;

    var audioCtx = null;
    var sourceNode = null;
    var lowNode = null;
    var midNode = null;
    var highNode = null;
    var gainNode = null;
    var currentFeedSlug = null;
    var desiredRate = null;
    var currentMeta = null;
    var webAudioAllowedForSource = false;

    function currentKey() {
      return LS_PREFIX + "current";
    }

    function loadCurrent() {
      var raw = lsGet(currentKey());
      if (!raw) return null;
      try {
        var obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        if (!obj.id) return null;
        return obj;
      } catch (_e) {
        return null;
      }
    }

    function saveCurrent(meta) {
      if (!meta || !meta.id) return;
      var payload = {
        id: meta.id,
        feedSlug: meta.feedSlug || parseEpisodeId(meta.id).feedSlug || "",
        episodeKey: meta.episodeKey || parseEpisodeId(meta.id).episodeKey || "",
        t: meta.t || "",
        ft: meta.ft || "",
        d: meta.d || "",
        a: meta.a || "",
        l: meta.l || "",
        im: meta.im || "",
        u: Date.now(),
      };
      lsSet(currentKey(), JSON.stringify(payload));
    }

    var SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

    function speedKeyForFeed(feedSlug) {
      return LS_PREFIX + "speed:feed:" + String(feedSlug || "");
    }

    function readLastSpeed() {
      return Number(lsGet(LS_PREFIX + "speed") || "1") || 1;
    }

    function readSpeedForFeed(feedSlug) {
      var slug = String(feedSlug || "").trim();
      if (slug) {
        var raw = lsGet(speedKeyForFeed(slug));
        var v = Number(raw || "");
        if (v) return v;
      }
      return readLastSpeed();
    }

    function setSpeed(v, opts) {
      var options = opts || {};
      var next = Number(v) || 1;
      // Snap to a supported speed (closest).
      var best = SPEEDS[0];
      var bestDist = Infinity;
      for (var i = 0; i < SPEEDS.length; i++) {
        var d = Math.abs(SPEEDS[i] - next);
        if (d < bestDist) {
          bestDist = d;
          best = SPEEDS[i];
        }
      }
      next = best;

      player.playbackRate = next;
      if (speedReadout) speedReadout.textContent = String(next) + "x";
      desiredRate = next;

      if (options.persist !== false) {
        // "Last used" default.
        lsSet(LS_PREFIX + "speed", String(next));
        // Per podcast (feed) override when known.
        if (currentFeedSlug) lsSet(speedKeyForFeed(currentFeedSlug), String(next));
      }
    }

    function stepSpeed(dir) {
      var cur = Number(player.playbackRate) || readLastSpeed();
      var idx = 0;
      for (var i = 0; i < SPEEDS.length; i++) {
        if (Math.abs(SPEEDS[i] - cur) < 0.001) {
          idx = i;
          break;
        }
      }
      var nextIdx = Math.max(0, Math.min(SPEEDS.length - 1, idx + dir));
      setSpeed(SPEEDS[nextIdx], { persist: true });
    }

    function setPreservePitch(value) {
      var v = Boolean(value);
      try {
        if ("preservesPitch" in player) player.preservesPitch = v;
        if ("mozPreservesPitch" in player) player.mozPreservesPitch = v;
        if ("webkitPreservesPitch" in player) player.webkitPreservesPitch = v;
      } catch (_e) {}
    }

    function ensureAudioGraph() {
      if (audioCtx) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        audioCtx = new AC();
        sourceNode = audioCtx.createMediaElementSource(player);

        lowNode = audioCtx.createBiquadFilter();
        lowNode.type = "lowshelf";
        lowNode.frequency.value = 120;

        midNode = audioCtx.createBiquadFilter();
        midNode.type = "peaking";
        midNode.frequency.value = 1000;
        midNode.Q.value = 1;

        highNode = audioCtx.createBiquadFilter();
        highNode.type = "highshelf";
        highNode.frequency.value = 3500;

        gainNode = audioCtx.createGain();

        sourceNode.connect(lowNode);
        lowNode.connect(midNode);
        midNode.connect(highNode);
        highNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        return true;
      } catch (_e) {
        audioCtx = null;
        sourceNode = null;
        lowNode = null;
        midNode = null;
        highNode = null;
        gainNode = null;
        return false;
      }
    }

    function setAudioNote(msg) {
      if (!audioNote) return;
      if (msg) {
        audioNote.textContent = msg;
        audioNote.removeAttribute("hidden");
      } else {
        audioNote.textContent = "";
        audioNote.setAttribute("hidden", "");
      }
    }

    function setEqEnabled(enabled) {
      var on = Boolean(enabled);
      if (gain) gain.disabled = !on;
      if (eqLow) eqLow.disabled = !on;
      if (eqMid) eqMid.disabled = !on;
      if (eqHigh) eqHigh.disabled = !on;
    }

    function computeWebAudioAllowed() {
      var src = player.currentSrc || player.src || "";
      return corsOkForUrl(src);
    }

    function updateEqAvailabilityUi() {
      if (!player.src) {
        setEqEnabled(true);
        setAudioNote("");
        webAudioAllowedForSource = false;
        return;
      }
      webAudioAllowedForSource = computeWebAudioAllowed();
      if (!webAudioAllowedForSource) {
        setEqEnabled(false);
        if (audioCtx) {
          setAudioNote("EQ/gain disabled for this audio host (CORS). Reload if audio went silent after enabling EQ.");
        } else {
          setAudioNote("EQ/gain disabled for this audio host (CORS). Playback still works.");
        }
      } else {
        setEqEnabled(true);
        setAudioNote("");
      }
    }

    function resumeAudioCtx() {
      if (!audioCtx) return;
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(function () {});
      }
    }

    function dbToLinear(db) {
      return Math.pow(10, (Number(db) || 0) / 20);
    }

    function applyAudioSettings() {
      var pitch = lsGet(LS_PREFIX + "pitch");
      var pitchOn = pitch == null ? true : pitch === "1";
      if (preservePitch) preservePitch.checked = pitchOn;
      setPreservePitch(pitchOn);

      var gainDb = Number(lsGet(LS_PREFIX + "gainDb") || "0") || 0;
      var lowDb = Number(lsGet(LS_PREFIX + "eqLow") || "0") || 0;
      var midDb = Number(lsGet(LS_PREFIX + "eqMid") || "0") || 0;
      var highDb = Number(lsGet(LS_PREFIX + "eqHigh") || "0") || 0;

      if (gain) gain.value = String(gainDb);
      if (eqLow) eqLow.value = String(lowDb);
      if (eqMid) eqMid.value = String(midDb);
      if (eqHigh) eqHigh.value = String(highDb);

      if (gainVal) gainVal.textContent = (gainDb >= 0 ? "+" : "") + gainDb + " dB";
      if (eqLowVal) eqLowVal.textContent = (lowDb >= 0 ? "+" : "") + lowDb + " dB";
      if (eqMidVal) eqMidVal.textContent = (midDb >= 0 ? "+" : "") + midDb + " dB";
      if (eqHighVal) eqHighVal.textContent = (highDb >= 0 ? "+" : "") + highDb + " dB";

      // Only build the graph if the user changed any WebAudio settings.
      var needsGraph = gainDb !== 0 || lowDb !== 0 || midDb !== 0 || highDb !== 0;
      updateEqAvailabilityUi();
      if (needsGraph && webAudioAllowedForSource && ensureAudioGraph()) {
        resumeAudioCtx();
        gainNode.gain.value = dbToLinear(gainDb);
        lowNode.gain.value = lowDb;
        midNode.gain.value = midDb;
        highNode.gain.value = highDb;
      }
    }

    setSpeed(readLastSpeed(), { persist: false });

    function setPlayButtonState() {
      if (!btnPlayPause) return;
      btnPlayPause.textContent = player.paused ? "Play" : "Pause";
    }

    function setScrubFromPlayer() {
      if (!scrub || scrubbing) return;
      var d = Number(player.duration) || 0;
      var p = Number(player.currentTime) || 0;
      var ratio = d > 0 ? Math.max(0, Math.min(1, p / d)) : 0;
      scrub.value = String(Math.floor(ratio * 1000));
    }

    function setTimeLabels() {
      if (tElapsed) tElapsed.textContent = fmtTime(player.currentTime || 0);
      if (tDuration) tDuration.textContent = isFinite(player.duration) ? fmtTime(player.duration) : "0:00";
    }

    function saveProgress(force) {
      if (!currentEpisodeId) return;
      if (!player.src) return;
      var now = Date.now();
      var pos = Math.floor(Number(player.currentTime) || 0);
      var dur = isFinite(player.duration) ? Math.floor(Number(player.duration) || 0) : 0;

      if (!force) {
        if (now - lastSaveMs < 4500) return;
        if (Math.abs(pos - lastSavedPos) < 5) return;
      }

      var done = dur > 0 && pos >= Math.max(0, dur - 3);
      writeProgress(currentEpisodeId, pos, dur, done);
      lastSavedPos = pos;
      lastSaveMs = now;
      refreshProgressForId(currentEpisodeId);
    }

    function startAutosave() {
      if (saveTimer) return;
      saveTimer = window.setInterval(function () {
        saveProgress(false);
      }, 5000);
    }

    function stopAutosave() {
      if (!saveTimer) return;
      window.clearInterval(saveTimer);
      saveTimer = null;
    }

    function updateMediaSession(title, artist, url, artUrl) {
      if (!("mediaSession" in navigator)) return;
      try {
        var art = String(artUrl || "").trim();
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: title || "Now playing",
          artist: artist || "",
          album: getSite().title || "",
          artwork: (art ? [{ src: art }] : []).concat([
            { src: getBasePath() + "assets/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: getBasePath() + "assets/icon-512.png", sizes: "512x512", type: "image/png" },
          ]),
        });
        navigator.mediaSession.setActionHandler("play", function () {
          player.play().catch(function () {});
        });
        navigator.mediaSession.setActionHandler("pause", function () {
          player.pause();
        });
        navigator.mediaSession.setActionHandler("seekbackward", function (details) {
          var s = (details && details.seekOffset) || 15;
          player.currentTime = Math.max(0, (player.currentTime || 0) - s);
          saveProgress(true);
        });
        navigator.mediaSession.setActionHandler("seekforward", function (details) {
          var s = (details && details.seekOffset) || 30;
          player.currentTime = Math.min(player.duration || Infinity, (player.currentTime || 0) + s);
          saveProgress(true);
        });
        if (url) navigator.mediaSession.setActionHandler("stop", function () {});
      } catch (_e) {}
    }

    function setActiveEpisodeId(episodeId) {
      $all(".episode.active").forEach(function (el) {
        el.classList.remove("active");
      });
      if (!episodeId) return;
      var target = $('.episode[data-episode-id="' + cssEscape(episodeId) + '"]');
      if (target) target.classList.add("active");
    }

    function selectMeta(hint, opts) {
      var meta = hint || {};
      var options = opts || {};
      if (!meta.id) return Promise.resolve(null);

      return resolveEpisodeMeta(meta)
        .then(function (full) {
          currentEpisodeId = full.id;
          currentFeedSlug = full.feedSlug || parseEpisodeId(full.id).feedSlug || null;
          currentMeta = full;
          setActiveEpisodeId(full.id);

          $("#now-title").textContent = full.t || "Now playing";
          var subtitleParts = [];
          if (full.ft) subtitleParts.push(esc(full.ft));
          if (full.l) subtitleParts.push('<a href="' + esc(full.l) + '" rel="noopener" target="_blank">Episode link</a>');
          if (full.d) subtitleParts.push(esc(full.d));
          $("#now-sub").innerHTML = subtitleParts.join(" · ");

          var prog = currentEpisodeId ? readProgress(currentEpisodeId) : null;
          lastSavedPos = prog && prog.p ? prog.p : 0;
          lastSaveMs = 0;
          pendingSeek = prog && prog.p && (!prog.d || prog.p < Math.max(0, prog.d - 10)) ? prog.p : null;

          var wantedRate = currentFeedSlug ? readSpeedForFeed(currentFeedSlug) : readLastSpeed();
          setSpeed(wantedRate, { persist: false });

          if (full.a) {
            try {
              if (corsOkForUrl(full.a)) player.crossOrigin = "anonymous";
              else player.removeAttribute("crossorigin");
            } catch (_e) {}
            if (player.src !== full.a) player.src = full.a;
          }
          updateEqAvailabilityUi();

          // If we're on this podcast page, keep ?e updated for deep links.
          try {
            if (
              full.feedSlug &&
              full.episodeKey &&
              window.location.pathname.indexOf("/podcasts/" + full.feedSlug + "/") !== -1
            ) {
              setQs("e", full.episodeKey);
            }
          } catch (_e) {}

          saveCurrent(full);
          updateMediaSession(full.t || "", full.ft || "", full.l || "", full.im || "");
          refreshAllProgress();
          renderHomePanels();

          if (options.autoplay) {
            resumeAudioCtx();
            return player
              .play()
              .catch(function () {})
              .then(function () {
                // Only write history on an explicit play.
                pushHistoryEntry({
                  id: full.id,
                  t: full.t || "",
                  ft: full.ft || "",
                  d: full.d || "",
                  a: full.a || "",
                  l: full.l || "",
                  im: full.im || "",
                  u: Date.now(),
                });
              })
              .then(function () {
                return full;
              });
          }

          return full;
        })
        .catch(function () {
          return null;
        });
    }

    function playMeta(hint) {
      return selectMeta(hint, { autoplay: true });
    }

    window.__AP_PLAYER__ = {
      playMeta: playMeta,
      selectMeta: function (meta) {
        return selectMeta(meta, { autoplay: false });
      },
      getCurrentId: function () {
        return currentEpisodeId;
      },
    };

    function shouldAutoplay() {
      return String(window.location.hash || "").toLowerCase().includes("autoplay");
    }

    var key = qs("e");
    var autoplay = shouldAutoplay();

    // Always restore the last-selected episode (without autoplay) so "Play" continues where you left off.
    var restored = false;
    var cur0 = loadCurrent();
    if (cur0 && cur0.id) {
      restored = true;
      // Restore UI immediately from saved data, even if we can't refetch episode metadata right now.
      try {
        currentEpisodeId = cur0.id;
        currentFeedSlug = cur0.feedSlug || parseEpisodeId(cur0.id).feedSlug || null;
        currentMeta = cur0;
        setActiveEpisodeId(cur0.id);

        $("#now-title").textContent = cur0.t || "Now playing";
        var subtitleParts0 = [];
        if (cur0.ft) subtitleParts0.push(esc(cur0.ft));
        if (cur0.l) subtitleParts0.push('<a href="' + esc(cur0.l) + '" rel="noopener" target="_blank">Episode link</a>');
        if (cur0.d) subtitleParts0.push(esc(cur0.d));
        $("#now-sub").innerHTML = subtitleParts0.join(" · ");

        var prog0 = readProgress(cur0.id) || null;
        lastSavedPos = prog0 && prog0.p ? prog0.p : 0;
        lastSaveMs = 0;
        pendingSeek = prog0 && prog0.p && (!prog0.d || prog0.p < Math.max(0, prog0.d - 10)) ? prog0.p : null;

        var wantedRate0 = currentFeedSlug ? readSpeedForFeed(currentFeedSlug) : readLastSpeed();
        setSpeed(wantedRate0, { persist: false });

        if (cur0.a) {
          try {
            if (corsOkForUrl(cur0.a)) player.crossOrigin = "anonymous";
            else player.removeAttribute("crossorigin");
          } catch (_e) {}
          if (player.src !== cur0.a) player.src = cur0.a;
        }

        updateEqAvailabilityUi();
        saveCurrent(cur0);
        updateMediaSession(cur0.t || "", cur0.ft || "", cur0.l || "", cur0.im || "");
        refreshAllProgress();
        renderHomePanels();
      } catch (_e) {}

      // Then attempt a normal resolve path (for missing audio/link/title fields) without changing autoplay.
      selectMeta(cur0, { autoplay: false });
    }

    // Deep-link only takes over playback if explicitly requested via #autoplay.
    // Otherwise it only becomes the default when there is no saved "current".
    if (key) {
      var target = $("#e-" + cssEscape(key));
      if (target) {
        var m = readEpisodeMetaFromElement(target);
        if (m && (autoplay || !restored)) selectMeta(m, { autoplay: autoplay });
      }
    }

    if (btnPlayPause) {
      btnPlayPause.addEventListener("click", function () {
        if (!player.src) {
          // Prefer the last-selected episode; otherwise fall back to most recent history entry.
          var cur = loadCurrent();
          if (cur && cur.id) {
            playMeta(cur);
            return;
          }
          var hist = loadHistory();
          if (hist && hist.length && hist[0] && hist[0].id) {
            playMeta(hist[0]);
            return;
          }
          var first = $(".episode");
          if (first) {
            var m = readEpisodeMetaFromElement(first);
            if (m) playMeta(m);
            return;
          }
          return;
        }
        resumeAudioCtx();
        if (player.paused) player.play().catch(function () {});
        else player.pause();
      });
    }

    if (btnBack15) {
      btnBack15.addEventListener("click", function () {
        player.currentTime = Math.max(0, (player.currentTime || 0) - 15);
        saveProgress(true);
      });
    }
    if (btnFwd30) {
      btnFwd30.addEventListener("click", function () {
        player.currentTime = Math.min(player.duration || Infinity, (player.currentTime || 0) + 30);
        saveProgress(true);
      });
    }
    if (btnSlower) {
      btnSlower.addEventListener("click", function () {
        stepSpeed(-1);
      });
    }
    if (btnFaster) {
      btnFaster.addEventListener("click", function () {
        stepSpeed(1);
      });
    }

    if (preservePitch) {
      preservePitch.addEventListener("change", function () {
        var on = Boolean(preservePitch.checked);
        setPreservePitch(on);
        lsSet(LS_PREFIX + "pitch", on ? "1" : "0");
      });
    }

    function bindDbSlider(input, labelEl, key) {
      if (!input) return;
      input.addEventListener("input", function () {
        var db = Number(input.value) || 0;
        if (labelEl) labelEl.textContent = (db >= 0 ? "+" : "") + db + " dB";
      });
      input.addEventListener("change", function () {
        var db = Number(input.value) || 0;
        lsSet(LS_PREFIX + key, String(db));
        applyAudioSettings();
      });
    }

    bindDbSlider(gain, gainVal, "gainDb");
    bindDbSlider(eqLow, eqLowVal, "eqLow");
    bindDbSlider(eqMid, eqMidVal, "eqMid");
    bindDbSlider(eqHigh, eqHighVal, "eqHigh");

    if (scrub) {
      scrub.addEventListener("input", function () {
        scrubbing = true;
        var d = Number(player.duration) || 0;
        var ratio = Number(scrub.value) / 1000;
        var t = d > 0 ? ratio * d : 0;
        if (tElapsed) tElapsed.textContent = fmtTime(t);
      });
      scrub.addEventListener("change", function () {
        var d = Number(player.duration) || 0;
        var ratio = Number(scrub.value) / 1000;
        var t = d > 0 ? ratio * d : 0;
        player.currentTime = t;
        scrubbing = false;
        saveProgress(true);
      });
    }

    player.addEventListener("loadedmetadata", function () {
      // Defensive: source changes can reset rate; keep the UI + element in sync.
      if (desiredRate != null) setSpeed(desiredRate, { persist: false });
      updateEqAvailabilityUi();
      setTimeLabels();
      if (pendingSeek != null && pendingSeek > 0) {
        try {
          player.currentTime = pendingSeek;
        } catch (_e) {}
        pendingSeek = null;
      }
      saveProgress(true);
      refreshAllProgress();
    });

    player.addEventListener("ratechange", function () {
      if (!speedReadout) return;
      var r = Number(player.playbackRate) || 1;
      r = Math.round(r * 100) / 100;
      speedReadout.textContent = String(r) + "x";
    });

    player.addEventListener("timeupdate", function () {
      setScrubFromPlayer();
      setTimeLabels();
      saveProgress(false);
    });

    player.addEventListener("play", function () {
      resumeAudioCtx();
      setPlayButtonState();
      startAutosave();
    });
    player.addEventListener("pause", function () {
      setPlayButtonState();
      saveProgress(true);
      stopAutosave();
    });
    player.addEventListener("ended", function () {
      setPlayButtonState();
      saveProgress(true);
      stopAutosave();
      // Auto-advance the queue if present.
      var next = dequeueNext();
      if (next && window.__AP_PLAYER__ && window.__AP_PLAYER__.playMeta) {
        window.__AP_PLAYER__.playMeta(next);
      }
      renderHomePanels();
      refreshQueueIndicators();
      maybeAutoCacheQueue({ force: false });
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "hidden") return;
      saveProgress(true);
    });
    window.addEventListener("beforeunload", function () {
      saveProgress(true);
    });

    setPlayButtonState();
    applyAudioSettings();

    // (restored above)
  }

  var indexPromise = null;
  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = fetch(getBasePath() + "index.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("Failed to load index.json");
      return r.json();
    });
    return indexPromise;
  }

  function scoreMatch(queryTokens, entry) {
    var title = String(entry.t || "").toLowerCase();
    var speakers = (entry.s || []).join(" ").toLowerCase();
    var topics = (entry.x || []).join(" ").toLowerCase();
    var hay = title + " " + speakers + " " + topics;
    var score = 0;
    queryTokens.forEach(function (t) {
      if (!t) return;
      if (title.includes(t)) score += 6;
      if (speakers.includes(t)) score += 4;
      if (topics.includes(t)) score += 2;
      if (hay.includes(t)) score += 1;
    });
    return score;
  }

  function joinPath(basePath, suffix) {
    var b = String(basePath || "/");
    if (!b.startsWith("/")) b = "/" + b;
    if (!b.endsWith("/")) b = b + "/";
    var s = String(suffix || "");
    s = s.replace(/^\//, "");
    return b + s;
  }

  function normalizePathname(p) {
    var out = String(p || "/");
    // Treat "/x" and "/x/" as equivalent for routing checks.
    if (out.endsWith("/index.html")) out = out.slice(0, -"/index.html".length);
    if (!out.endsWith("/")) out = out + "/";
    return out;
  }

  function focusSearch() {
    var root = $("#search-panel") || document;
    var input = $("#search-input", root) || $("#search-input");
    if (input && input.focus) input.focus();
  }

  var searchUi = null;
  function ensureSearchUi() {
    if (searchUi && searchUi.input && document.contains(searchUi.input)) return searchUi;
    var root = $("#search-panel") || document;
    var input = $("#search-input", root) || $("#search-input");
    var results = $("#search-results", root) || $("#search-results");
    var status = $("#search-status", root) || $("#search-status");
    var includePlayed = $("#search-include-played", root) || $("#search-include-played");
    var playedNormal = $("#search-played-normal", root) || $("#search-played-normal");
    if (!input || !results || !status) return null;

    var basePath = getBasePath();

    function playFirstResult() {
      var first = results.querySelector ? results.querySelector("[data-episode-id]") : null;
      if (!first) return;
      var meta = readEpisodeMetaFromElement(first);
      if (!meta) return;
      if (window.__AP_PLAYER__ && window.__AP_PLAYER__.playMeta) window.__AP_PLAYER__.playMeta(meta);
    }

    function handler() {
      var q = input.value.trim().toLowerCase();
      setQs("q", q || null);
      if (!q) {
        status.textContent = "Type to search.";
        results.innerHTML = "";
        return;
      }
      var tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
      status.textContent = "Searching…";

      loadIndex().then(function (index) {
        var incPlayed = includePlayed ? Boolean(includePlayed.checked) : true;
        var normal = playedNormal ? Boolean(playedNormal.checked) : false;
        if (!incPlayed && playedNormal) {
          playedNormal.checked = false;
          playedNormal.disabled = true;
          normal = false;
        } else if (playedNormal) {
          playedNormal.disabled = false;
        }

        var matches = index
          .map(function (e) {
            var id = e.f + ":" + e.k;
            var prog = readProgress(id);
            return { e: e, id: id, s: scoreMatch(tokens, e), played: Boolean(prog && prog.c) };
          })
          .filter(function (x) {
            return x.s > 0;
          })
          .filter(function (x) {
            if (!incPlayed && x.played) return false;
            return true;
          })
          .sort(function (a, b) {
            if (incPlayed && !normal) {
              if (a.played !== b.played) return a.played ? 1 : -1;
            }
            return b.s - a.s;
          })
          .slice(0, 80);

        status.textContent = matches.length + " results";
        results.innerHTML = matches
          .map(function (m) {
            var e = m.e;
            var url = basePath + "podcasts/" + encodeURIComponent(e.f) + "/?e=" + encodeURIComponent(e.k);
            var line = esc(e.ft) + " · " + esc(e.d || "");
            var id = esc(m.id);
            var seed = e.ft || e.f;
            return (
              '<li class="episode-row' +
              (m.played ? " is-played" : "") +
              '" data-episode-id="' +
              id +
              '" data-feed-slug="' +
              esc(e.f) +
              '" data-episode-key="' +
              esc(e.k) +
              '" data-episode-title="' +
              esc(e.t) +
              '" data-episode-date="' +
              esc(e.d || "") +
              '" data-feed-title="' +
              esc(e.ft || "") +
              '" data-episode-image="' +
              esc(e.im || "") +
              '">' +
              '<div class="row-main">' +
              '<div class="row-head"><span class="row-art">' +
              artHtml(e.im, seed) +
              '</span><div class="row-text"><a href="' +
              url +
              '">' +
              esc(e.t) +
              '</a> <span class="muted">(' +
              line +
              ")</span></div></div>" +
              "</div>" +
              '<div class="row-actions">' +
              '<button class="btn-primary btn-sm" type="button" data-action="play">Play</button>' +
              '<button class="btn btn-sm queue-btn" type="button" data-action="queue">Queue</button>' +
              '<details class="menu">' +
              '  <summary class="btn btn-sm" aria-label="More actions">⋯</summary>' +
              '  <div class="menu-panel card">' +
              '    <button class="btn btn-sm" type="button" data-action="played">Mark played</button>' +
              '    <button class="btn btn-sm" type="button" data-action="offline">Offline</button>' +
              "  </div>" +
              "</details>" +
              "</div>" +
              '<div class="mini-progress"><div class="mini-progress-bar" data-progress-bar></div></div>' +
              '<div class="mini-progress-text muted" data-progress-text></div>' +
              "</li>"
            );
          })
          .join("");
        refreshAllProgress();
        refreshQueueIndicators();
      });
    }

    if (!input.getAttribute("data-bound")) {
      input.setAttribute("data-bound", "1");
      if (includePlayed) includePlayed.onchange = handler;
      if (playedNormal) playedNormal.onchange = handler;
      input.oninput = handler;
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          playFirstResult();
        }
      });
    }

    searchUi = { root: root, input: input, results: results, status: status, includePlayed: includePlayed, playedNormal: playedNormal, handler: handler };
    return searchUi;
  }

  function openSearchPanel() {
    var panel = $("#search-panel");
    if (!panel) return;
    document.body.classList.add("search-open");
    panel.removeAttribute("hidden");
    var ui = ensureSearchUi();
    if (!ui) return;
    var q0 = qs("q");
    if (q0 && ui.input.value !== q0) ui.input.value = q0;
    focusSearch();
    if (ui.input.value.trim()) ui.handler();
    else ui.status.textContent = "Type to search.";
  }

  function closeSearchPanel() {
    var panel = $("#search-panel");
    if (!panel) return;
    document.body.classList.remove("search-open");
    panel.setAttribute("hidden", "");
  }

  function initSearch() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var openBtn = t.closest("[data-open-search]");
      if (openBtn) {
        e.preventDefault();
        openSearchPanel();
        return;
      }
      var closeBtn = t.closest("[data-close-search]");
      if (closeBtn) {
        e.preventDefault();
        closeSearchPanel();
        return;
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var target = e.target;
        var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        openSearchPanel();
      }
      if (e.key === "Escape") {
        closeData();
        closeSearchPanel();
      }
    });
  }

  function initHeaderOffset() {
    function setVar() {
      var header = $(".site-header");
      if (!header) return;
      var h = header.getBoundingClientRect().height || 0;
      // Extra breathing room so the player doesn't kiss the header border.
      document.documentElement.style.setProperty("--header-offset", Math.ceil(h + 10) + "px");
    }
    setVar();
    window.addEventListener("resize", setVar);
  }

  function initDescriptions() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (!t.hasAttribute("data-desc-toggle")) return;
      e.preventDefault();

      var wrap = t.closest ? t.closest("[data-desc-wrap]") : null;
      if (!wrap) return;
      var snip = wrap.querySelector("[data-desc-snippet]");
      var full = wrap.querySelector("[data-desc-full]");
      if (!snip || !full) return;

      var open = !full.hasAttribute("hidden");
      if (open) {
        full.setAttribute("hidden", "");
        snip.removeAttribute("hidden");
      } else {
        snip.setAttribute("hidden", "");
        full.removeAttribute("hidden");
      }

      // Keep aria-expanded consistent for both buttons if present.
      $all("[data-desc-toggle]", wrap).forEach(function (btn) {
        btn.setAttribute("aria-expanded", open ? "false" : "true");
      });
    });
  }

  function initSpaNavigation() {
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
          // Update UI that depends on the current page content.
          refreshAllProgress();
          renderHomePanels();
          refreshQueueIndicators();
          applySpeakersUi();
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

  function initPwa() {
    if (!("serviceWorker" in navigator)) return;
    function register() {
      var basePath = getBasePath();
      var url = basePath + "sw.js";
      try {
        console.log("[pwa] registering", { url: url, scope: basePath });
      } catch (_e) {}
      navigator.serviceWorker
        .register(url, { scope: basePath })
        .then(function (reg) {
          try {
            console.log("[pwa] registered", {
              scope: reg && reg.scope,
              active: Boolean(reg && reg.active),
              installing: Boolean(reg && reg.installing),
              waiting: Boolean(reg && reg.waiting),
            });
          } catch (_e2) {}
        })
        .catch(function (err) {
          try {
            console.warn("[pwa] register failed", err);
          } catch (_e3) {}
        });

      try {
        navigator.serviceWorker.addEventListener("controllerchange", function () {
          try {
            console.log("[pwa] controllerchange", {
              hasController: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
            });
          } catch (_e4) {}
        });
      } catch (_e5) {}
    }

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
    }
  }

  function initProgress() {
    refreshAllProgress();
    renderHomePanels();
    refreshQueueIndicators();
    window.addEventListener("storage", function (e) {
      if (!e || !e.key) return;
      if (
        String(e.key).startsWith(LS_PREFIX + "p:") ||
        e.key === historyKey() ||
        e.key === queueKey()
      ) {
        refreshAllProgress();
        renderHomePanels();
        refreshQueueIndicators();
      }
    });
  }

  function closeData() {
    var modal = $("#data-modal");
    if (modal) modal.classList.remove("open");
  }

  function speakersIncludeOwnKey() {
    return LS_PREFIX + "speakers.includeOwn";
  }
  function readSpeakersIncludeOwn() {
    return lsGet(speakersIncludeOwnKey()) === "1";
  }
  function writeSpeakersIncludeOwn(next) {
    lsSet(speakersIncludeOwnKey(), next ? "1" : "0");
  }

  function applySpeakersUi() {
    var includeOwn = readSpeakersIncludeOwn();

    var speakersToggle = $("#speakers-include-own");
    if (speakersToggle) {
      speakersToggle.checked = includeOwn;
      var items = $all("[data-speaker-row]");
      items.forEach(function (li) {
        var guest = Number(li.getAttribute("data-count-guest") || 0) || 0;
        var total = Number(li.getAttribute("data-count-total") || 0) || 0;
        var count = includeOwn ? total : guest;
        var out = li.querySelector("[data-speaker-count]");
        if (out) out.textContent = String(count);
      });

      var ul = items.length ? items[0].parentElement : null;
      if (ul) {
        items
          .slice()
          .sort(function (a, b) {
            var an = Number(a.getAttribute(includeOwn ? "data-count-total" : "data-count-guest") || 0) || 0;
            var bn = Number(b.getAttribute(includeOwn ? "data-count-total" : "data-count-guest") || 0) || 0;
            if (bn !== an) return bn - an;
            var aName = String(a.getAttribute("data-name") || "").toLowerCase();
            var bName = String(b.getAttribute("data-name") || "").toLowerCase();
            if (aName < bName) return -1;
            if (aName > bName) return 1;
            return 0;
          })
          .forEach(function (li) {
            ul.appendChild(li);
          });
      }
    }

    var speakerToggle = $("#speaker-include-own");
    if (speakerToggle) {
      speakerToggle.checked = includeOwn;
      $all(".speaker-group[data-own='1']").forEach(function (d) {
        if (includeOwn) d.removeAttribute("hidden");
        else d.setAttribute("hidden", "");
      });
    }
  }

  function markPlayed(episodeId) {
    if (!episodeId) return;
    var p = readProgress(episodeId) || { p: 0, d: 0, c: false };
    writeProgress(episodeId, p.p || 0, p.d || 0, true);
    removeFromHistory(episodeId);
    removeFromQueue(episodeId);
    refreshProgressForId(episodeId);
    refreshAllProgress();
    renderHomePanels();
    refreshQueueIndicators();
  }

  function markUnplayed(episodeId) {
    if (!episodeId) return;
    var p = readProgress(episodeId) || { p: 0, d: 0, u: 0, c: false };
    writeProgressObj(episodeId, { p: p.p || 0, d: p.d || 0, u: Date.now(), c: false });
    refreshProgressForId(episodeId);
    refreshAllProgress();
    renderHomePanels();
    refreshQueueIndicators();
  }

  function markPlayedMany(ids) {
    var list = (ids || []).filter(Boolean);
    if (!list.length) return;
    var set = new Set(list);
    var now = Date.now();
    list.forEach(function (id) {
      var p = readProgress(id) || { p: 0, d: 0, u: 0, c: false };
      writeProgressObj(id, { p: p.p || 0, d: p.d || 0, u: Math.max(Number(p.u) || 0, now), c: true });
    });
    saveHistory(
      loadHistory().filter(function (it) {
        return it && it.id && !set.has(it.id);
      })
    );
    saveQueue(
      loadQueue().filter(function (it) {
        return it && it.id && !set.has(it.id);
      })
    );
    refreshAllProgress();
    renderHomePanels();
    refreshQueueIndicators();
  }

  function initEpisodeActions() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest("[data-action]");
      if (!btn) return;

      var action = btn.getAttribute("data-action") || "";
      var row = btn.closest("[data-episode-id]");
      if (!row) return;

      e.preventDefault();

      var meta = readEpisodeMetaFromElement(row);
      if (!meta) return;

      // Close any open overflow menu.
      try {
        var d = btn.closest("details");
        if (d && d.classList && d.classList.contains("menu")) d.open = false;
      } catch (_e) {}

      if (action === "play") {
        if (meta && !meta.ft) meta.ft = $("h1") ? $("h1").textContent : "";
        if (window.__AP_PLAYER__ && window.__AP_PLAYER__.playMeta) window.__AP_PLAYER__.playMeta(meta);
        return;
      }

      if (action === "queue") {
        if (isQueuedId(meta.id)) {
          removeFromQueue(meta.id);
          renderHomePanels();
          refreshQueueIndicators();
          maybeAutoCacheQueue({ force: false });
          return;
        }
        if (meta && !meta.ft) meta.ft = $("h1") ? $("h1").textContent : "";
        resolveEpisodeMeta(meta)
          .then(function (full) {
            enqueue({
              id: full.id,
              t: full.t || "",
              ft: full.ft || "",
              d: full.d || "",
              a: full.a || "",
              l: full.l || "",
              im: full.im || "",
              u: Date.now(),
            });
            renderHomePanels();
            refreshQueueIndicators();
            maybeAutoCacheQueue({ force: false });
          })
          .catch(function () {});
        return;
      }

      if (action === "remove") {
        removeFromQueue(meta.id);
        renderHomePanels();
        refreshQueueIndicators();
        maybeAutoCacheQueue({ force: false });
        return;
      }

      if (action === "played") {
        var p = readProgress(meta.id);
        if (p && p.c) markUnplayed(meta.id);
        else markPlayed(meta.id);
        maybeAutoCacheQueue({ force: false });
        return;
      }

      if (action === "bulk-older" || action === "bulk-newer") {
        var pivot = btn.closest(".episode");
        if (!pivot) return;
        var container = pivot.parentElement || document;
        var episodes = $all(".episode", container);
        var pivotIndex = episodes.indexOf(pivot);
        if (pivotIndex < 0) pivotIndex = 0;
        var ids = [];
        for (var i = 0; i < episodes.length; i++) {
          if (action === "bulk-older" && i <= pivotIndex) continue;
          if (action === "bulk-newer" && i >= pivotIndex) continue;
          var id = episodes[i].getAttribute("data-episode-id") || "";
          if (id) ids.push(id);
        }
        markPlayedMany(ids);
        return;
      }

      if (action === "offline") {
        btn.disabled = true;
        var prevText = btn.textContent;
        btn.textContent = "Offline…";
        resolveEpisodeMeta(meta)
          .then(function (full) {
            if (!full.a) throw new Error("No audio URL");
            return isAudioCached(full.a).then(function (cached) {
              var act = cached ? "remove" : "cache";
              return swRequest({ type: "ap-media", action: act, url: full.a }).then(function (res) {
                return { res: res, cached: cached, url: full.a };
              });
            });
          })
          .then(function (x) {
            if (!x || !x.res || !x.res.ok) throw new Error((x && x.res && x.res.error) || "offline cache failed");
            if (x && x.url && typeof x.res.cors === "boolean") rememberCorsForUrl(x.url, x.res.cors);
            btn.textContent = x.cached ? "Offline" : "Offline ✓";
            refreshOfflineStatus();
          })
          .catch(function () {
            btn.textContent = prevText || "Offline";
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
    });
  }

  function initMenus() {
    function closeAll(except) {
      $all("details.menu[open]").forEach(function (d) {
        if (except && d === except) return;
        d.open = false;
      });
    }

    document.addEventListener("toggle", function (e) {
      var t = e.target;
      if (!t || !t.classList || !t.classList.contains("menu")) return;
      if (t.open) closeAll(t);
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("details.menu")) return;
      closeAll(null);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAll(null);
    });
  }

  initHeaderOffset();
  initPlayer();
  initSearch();
  initProgress();
  initDescriptions();
  initEpisodeActions();
  initMenus();
  initSpaNavigation();
  initDataPanel({
    $: $,
    $all: $all,
    LS_PREFIX: LS_PREFIX,
    lsGet: lsGet,
    loadHistory: loadHistory,
    saveHistory: saveHistory,
    loadQueue: loadQueue,
    saveQueue: saveQueue,
    readProgress: readProgress,
    writeProgressObj: writeProgressObj,
    refreshAllProgress: refreshAllProgress,
    renderHomePanels: renderHomePanels,
    refreshQueueIndicators: refreshQueueIndicators,
    readOfflineSettings: readOfflineSettings,
    writeOfflineSettings: writeOfflineSettings,
    refreshOfflineStatus: refreshOfflineStatus,
    maybeAutoCacheQueue: maybeAutoCacheQueue,
  });
  initPwa();
  ensureSearchUi();
  applySpeakersUi();

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "speakers-include-own" || t.id === "speaker-include-own") {
      writeSpeakersIncludeOwn(Boolean(t.checked));
      applySpeakersUi();
    }
  });

  window.addEventListener("load", function () {
    // Auto-offline queue (if enabled) should run after the page is settled.
    setTimeout(function () {
      maybeAutoCacheQueue({ force: false });
    }, 900);
  });
})();
