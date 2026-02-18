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

  function refreshAllProgress() {
    $all("[data-episode-id]").forEach(function (el) {
      updateProgressElement(el);
    });
  }

  function refreshProgressForId(episodeId) {
    var sel = '[data-episode-id="' + cssEscape(episodeId) + '"]';
    $all(sel).forEach(function (el) {
      updateProgressElement(el);
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
    return {
      id: id,
      feedSlug: feedSlug,
      episodeKey: episodeKey,
      t: title,
      d: date,
      ft: feedTitle,
      a: audio,
      l: link,
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
        a: full.a,
        l: full.l,
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
          '">' +
          '<div class="row-main">' +
          '<a href="' +
          esc(url) +
          '">' +
          esc(it.t || "") +
          "</a>" +
          (meta ? '<span class="muted">(' + meta + ")</span>" : "") +
          "</div>" +
          '<div class="row-actions">' +
          '<button class="btn-primary btn-sm" type="button" data-action="play">Resume</button>' +
          '<button class="btn btn-sm" type="button" data-action="queue">+Queue</button>' +
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
          '">' +
          '<div class="row-main">' +
          '<a href="' +
          esc(url) +
          '">' +
          esc(it.t || "") +
          "</a>" +
          (meta ? '<span class="muted">(' + meta + ")</span>" : "") +
          "</div>" +
          '<div class="row-actions">' +
          '<button class="btn-primary btn-sm" type="button" data-action="play">Play</button>' +
          '<details class="menu">' +
          '  <summary class="btn btn-sm" aria-label="More actions">⋯</summary>' +
          '  <div class="menu-panel card">' +
          '    <button class="btn btn-sm" type="button" data-action="remove">Remove</button>' +
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
      if (needsGraph && ensureAudioGraph()) {
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

    function updateMediaSession(title, artist, url) {
      if (!("mediaSession" in navigator)) return;
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: title || "Now playing",
          artist: artist || "",
          album: getSite().title || "",
          artwork: [
            { src: getBasePath() + "assets/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: getBasePath() + "assets/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
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
            if (player.src !== full.a) player.src = full.a;
          }

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
          updateMediaSession(full.t || "", full.ft || "", full.l || "");
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

  function isSearchPage() {
    var base = new URL(getBasePath(), window.location.origin);
    var p = window.location.pathname;
    return p === base.pathname + "search/" || p === base.pathname + "search/index.html";
  }

  function focusSearch() {
    var input = $("#search-input");
    if (input && input.focus) input.focus();
  }

  function renderSearchIntoPage() {
    if (!isSearchPage()) return;
    var input = $("#search-input");
    var results = $("#search-results");
    var status = $("#search-status");
    var includePlayed = $("#search-include-played");
    var playedNormal = $("#search-played-normal");
    if (!input || !results || !status) return;

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
              '">' +
              '<div class="row-main">' +
              '<a href="' +
              url +
              '">' +
              esc(e.t) +
              '</a> <span class="muted">(' +
              line +
              ")</span>" +
              "</div>" +
              '<div class="row-actions">' +
              '<button class="btn-primary btn-sm" type="button" data-action="play">Play</button>' +
              '<button class="btn btn-sm" type="button" data-action="queue">+Queue</button>' +
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

    // Initial load from ?q=
    var q0 = qs("q");
    if (q0 && input.value !== q0) input.value = q0;

    // Focus immediately so typing works even while the index is loading.
    focusSearch();

    // Warm index.
    status.textContent = "Loading index…";
    loadIndex()
      .then(function () {
        handler();
      })
      .catch(function (err) {
        status.textContent = String(err || "Index load failed");
      });
  }

  function initSearch() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var target = e.target;
        var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        var basePath = getBasePath();
        if (window.__AP_NAV__ && window.__AP_NAV__.go) {
          window.__AP_NAV__.pendingFocusSearch = true;
          window.__AP_NAV__.go(basePath + "search/");
        } else {
          window.location.assign(basePath + "search/");
        }
      }
      if (e.key === "Escape") {
        closeData();
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
    var basePathname = base.pathname;
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
          // Update UI that depends on the current page content.
          refreshAllProgress();
          renderHomePanels();
          renderSearchIntoPage();
          // Don't auto-switch playback on navigation; deep-link autoplay happens on full load only.
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        })
        .catch(function () {})
        .finally(function () {
          navigating = false;
          var m = document.querySelector(mainSel);
          if (m) m.classList.remove("nav-loading");
          if (window.__AP_NAV__ && window.__AP_NAV__.pendingFocusSearch) {
            window.__AP_NAV__.pendingFocusSearch = false;
            focusSearch();
          }
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
      if (!url.pathname.startsWith(basePathname)) return;

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
      pendingFocusSearch: false,
    };
  }

  function initPwa() {
    if (!("serviceWorker" in navigator)) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    window.addEventListener("load", function () {
      var basePath = getBasePath();
      navigator.serviceWorker
        .register(basePath + "sw.js", { scope: basePath })
        .catch(function () {});
    });
  }

  function initProgress() {
    refreshAllProgress();
    renderHomePanels();
    window.addEventListener("storage", function (e) {
      if (!e || !e.key) return;
      if (
        String(e.key).startsWith(LS_PREFIX + "p:") ||
        e.key === historyKey() ||
        e.key === queueKey()
      ) {
        refreshAllProgress();
        renderHomePanels();
      }
    });
  }

  function markPlayed(episodeId) {
    if (!episodeId) return;
    var p = readProgress(episodeId) || { p: 0, d: 0, c: false };
    writeProgress(episodeId, p.p || 0, p.d || 0, true);
    removeFromHistory(episodeId);
    removeFromQueue(episodeId);
    refreshProgressForId(episodeId);
    renderHomePanels();
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
  }

  function openData() {
    var modal = $("#data-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "data-modal";
      modal.className = "modal";
      modal.innerHTML =
        '<div class="modal-card">' +
        '  <div class="modal-row">' +
        '    <div style="flex:1;font-weight:650">Data</div>' +
        '    <button type="button" id="data-close" class="btn">Close</button>' +
        "  </div>" +
        '  <div class="modal-row" style="flex-wrap:wrap">' +
        '    <button type="button" id="data-export" class="btn-primary">Export history</button>' +
        '    <label class="btn" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer">' +
        '      Import <input id="data-import" type="file" accept="application/json" style="display:none" />' +
        "    </label>" +
        "  </div>" +
        '  <div id="data-status" class="muted"></div>' +
        "</div>";
      document.body.appendChild(modal);
      $("#data-close", modal).addEventListener("click", closeData);
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeData();
      });
    }
    modal.classList.add("open");
    var status = $("#data-status", modal);
    if (status) status.textContent = "";
  }

  function closeData() {
    var modal = $("#data-modal");
    if (modal) modal.classList.remove("open");
  }

  function collectExport() {
    var out = {
      version: 1,
      exported_at: new Date().toISOString(),
      history: loadHistory(),
      queue: loadQueue(),
      progress: {},
      speeds: {},
      settings: {
        speed: Number(lsGet(LS_PREFIX + "speed") || "1") || 1,
      },
    };

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(LS_PREFIX + "p:")) {
          var id = k.slice((LS_PREFIX + "p:").length);
          var p = readProgress(id);
          if (!p) continue;
          if (p.c || p.p > 0) out.progress[id] = p;
        }
        if (k.startsWith(LS_PREFIX + "speed:feed:")) {
          var slug = k.slice((LS_PREFIX + "speed:feed:").length);
          var v = Number(lsGet(k) || "") || 0;
          if (v) out.speeds[slug] = v;
        }
      }
    } catch (_e) {}

    return out;
  }

  function downloadJson(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 500);
  }

  function mergeHistory(existing, incoming) {
    var map = new Map();
    (existing || []).forEach(function (it) {
      if (it && it.id) map.set(it.id, it);
    });
    (incoming || []).forEach(function (it) {
      if (!it || !it.id) return;
      var prev = map.get(it.id);
      if (!prev) {
        map.set(it.id, it);
        return;
      }
      var pu = Number(prev.u) || 0;
      var iu = Number(it.u) || 0;
      map.set(it.id, iu >= pu ? it : prev);
    });
    var arr = Array.from(map.values());
    arr.sort(function (a, b) {
      return (Number(b.u) || 0) - (Number(a.u) || 0);
    });
    return arr.slice(0, 200);
  }

  function mergeQueue(existing, incoming) {
    var seen = new Set();
    var out = [];
    (existing || []).forEach(function (it) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    });
    (incoming || []).forEach(function (it) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    });
    return out.slice(0, 200);
  }

  function applyImport(obj) {
    if (!obj || typeof obj !== "object") throw new Error("Invalid file");
    if (Number(obj.version) !== 1) throw new Error("Unsupported version");

    saveHistory(mergeHistory(loadHistory(), obj.history || []));
    saveQueue(mergeQueue(loadQueue(), obj.queue || []));

    var progress = obj.progress || {};
    Object.keys(progress).forEach(function (id) {
      var incoming = progress[id];
      if (!incoming || typeof incoming !== "object") return;
      var prev = readProgress(id);
      var pu = prev ? Number(prev.u) || 0 : 0;
      var iu = Number(incoming.u) || 0;
      if (!prev || iu >= pu) writeProgressObj(id, incoming);
    });

    var speeds = obj.speeds || {};
    Object.keys(speeds).forEach(function (slug) {
      var v = Number(speeds[slug]) || 0;
      if (v) lsSet(LS_PREFIX + "speed:feed:" + slug, String(v));
    });
    if (obj.settings && obj.settings.speed) {
      var s = Number(obj.settings.speed) || 0;
      if (s) lsSet(LS_PREFIX + "speed", String(s));
    }

    refreshAllProgress();
    renderHomePanels();
  }

  function initData() {
    $all("[data-open-data]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openData();
      });
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest("#data-export");
      if (!btn) return;
      e.preventDefault();
      var payload = collectExport();
      var d = new Date();
      var y = String(d.getFullYear());
      var m = String(d.getMonth() + 1).padStart(2, "0");
      var day = String(d.getDate()).padStart(2, "0");
      downloadJson("podcast-history-" + y + m + day + ".json", payload);
      var status = $("#data-status");
      if (status) status.textContent = "Exported.";
    });

    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || t.id !== "data-import") return;
      var file = t.files && t.files[0];
      if (!file) return;
      var status = $("#data-status");
      if (status) status.textContent = "Importing…";
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(String(reader.result || ""));
          applyImport(obj);
          if (status) status.textContent = "Imported.";
        } catch (err) {
          if (status) status.textContent = String(err || "Import failed");
        } finally {
          t.value = "";
        }
      };
      reader.readAsText(file);
    });
  }

  function initEpisodeActions() {
    function swRequest(msg) {
      return new Promise(function (resolve) {
        if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
          resolve({ ok: false, error: "Service worker not active (install the PWA / refresh on HTTPS)." });
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

    function mediaCacheKey(url) {
      try {
        return new Request(String(url || ""), { method: "GET", mode: "no-cors", credentials: "omit", redirect: "follow" });
      } catch (_e) {
        return null;
      }
    }

    function isMediaCached(url) {
      if (!("caches" in window)) return Promise.resolve(false);
      var req = mediaCacheKey(url);
      if (!req) return Promise.resolve(false);
      return window.caches
        .open("ap-media-v1")
        .then(function (cache) {
          return cache.match(req).then(function (resp) {
            return Boolean(resp);
          });
        })
        .catch(function () {
          return false;
        });
    }

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
              u: Date.now(),
            });
            renderHomePanels();
          })
          .catch(function () {});
        return;
      }

      if (action === "remove") {
        removeFromQueue(meta.id);
        renderHomePanels();
        return;
      }

      if (action === "played") {
        markPlayed(meta.id);
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
            return isMediaCached(full.a).then(function (cached) {
              var act = cached ? "remove" : "cache";
              return swRequest({ type: "ap-media", action: act, url: full.a }).then(function (res) {
                return { res: res, cached: cached };
              });
            });
          })
          .then(function (x) {
            if (!x || !x.res || !x.res.ok) throw new Error((x && x.res && x.res.error) || "offline cache failed");
            btn.textContent = x.cached ? "Offline" : "Offline ✓";
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

  initHeaderOffset();
  initPlayer();
  initSearch();
  initProgress();
  initDescriptions();
  initEpisodeActions();
  initSpaNavigation();
  initData();
  initPwa();
  renderSearchIntoPage();
})();
