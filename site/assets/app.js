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

  function isHomePage() {
    var base = new URL(getBasePath(), window.location.origin);
    var p = window.location.pathname;
    return p === base.pathname || p === base.pathname + "index.html";
  }

  function renderHistoryPanel() {
    if (!isHomePage()) return;
    var host = $("#client-panels");
    if (!host) return;
    var items = loadHistory();
    if (!items.length) return;

    var basePath = getBasePath();
    var visible = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.id || !it.t) continue;
      // Hide completed items from "continue".
      var prog = readProgress(it.id);
      if (prog && prog.c) continue;
      visible.push(it);
      if (visible.length >= 12) break;
    }

    if (!visible.length) return;

    var html = '<section class="card"><h2>Continue listening</h2><ul class="list">';
    visible.forEach(function (it) {
      var parts = String(it.id).split(":");
      var feedSlug = parts[0] || "";
      var episodeKey = parts.slice(1).join(":");
      var url = basePath + "podcasts/" + encodeURIComponent(feedSlug) + "/?e=" + encodeURIComponent(episodeKey);
      var meta = (it.ft ? esc(it.ft) + " · " : "") + (it.d ? esc(it.d) : "");
      html +=
        '<li class="episode-row" data-episode-id="' +
        esc(it.id) +
        '">' +
        '<a href="' +
        esc(url) +
        '">' +
        esc(it.t) +
        "</a> " +
        (meta ? '<span class="muted">(' + meta + ")</span>" : "") +
        '<div class="mini-progress"><div class="mini-progress-bar" data-progress-bar></div></div>' +
        '<div class="mini-progress-text muted" data-progress-text></div>' +
        "</li>";
    });
    html += "</ul></section>";
    host.innerHTML = html;
    refreshAllProgress();
  }

  function initPlayer() {
    var player = $("#player");
    if (!player) return;

    var btnPlayPause = $("#btn-playpause");
    var btnBack15 = $("#btn-back15");
    var btnFwd30 = $("#btn-fwd30");
    var scrub = $("#scrub");
    var tElapsed = $("#t-elapsed");
    var tDuration = $("#t-duration");
    var speed = $("#speed");
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

    var savedSpeed = Number(lsGet(LS_PREFIX + "speed") || "1") || 1;
    if (speed) speed.value = String(savedSpeed);
    player.playbackRate = savedSpeed;

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

    function activateEpisode(li) {
      $all(".episode.active").forEach(function (el) {
        el.classList.remove("active");
      });

      li.classList.add("active");
      currentEpisodeId = li.getAttribute("data-episode-id") || null;
      var audio = li.getAttribute("data-episode-audio") || "";
      var title = li.getAttribute("data-episode-title") || "";
      var date = li.getAttribute("data-episode-date") || "";
      var link = li.getAttribute("data-episode-link") || "";
      var key = li.getAttribute("data-episode-key") || "";

      $("#now-title").textContent = title || "Now playing";
      $("#now-sub").innerHTML = link
        ? '<a href="' + esc(link) + '" rel="noopener">Episode link</a> · ' + esc(date)
        : esc(date);

      if (audio) {
        var prog = currentEpisodeId ? readProgress(currentEpisodeId) : null;
        lastSavedPos = prog && prog.p ? prog.p : 0;
        lastSaveMs = 0;
        pendingSeek = prog && prog.p && (!prog.d || prog.p < Math.max(0, prog.d - 10)) ? prog.p : null;
        player.src = audio;
        player.play().catch(function () {});
      }

      // History entry is tiny and updated only when you actively choose an episode.
      if (currentEpisodeId) {
        pushHistoryEntry({
          id: currentEpisodeId,
          t: title,
          ft: $("h1") ? $("h1").textContent : "",
          d: date,
          u: Date.now(),
        });
      }

      updateMediaSession(title, $("h1") ? $("h1").textContent : "", link);

      setQs("e", key);
      li.scrollIntoView({ block: "nearest" });
    }

    $all(".episode [data-play]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var li = btn.closest(".episode");
        if (li) activateEpisode(li);
      });
    });

    var key = qs("e");
    if (key) {
      var target = $("#e-" + cssEscape(key));
      if (target) activateEpisode(target);
    }

    if (btnPlayPause) {
      btnPlayPause.addEventListener("click", function () {
        if (!player.src) {
          var first = $(".episode");
          if (first) activateEpisode(first);
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
    if (speed) {
      speed.addEventListener("change", function () {
        var v = Number(speed.value) || 1;
        player.playbackRate = v;
        lsSet(LS_PREFIX + "speed", String(v));
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

  function openSearch() {
    var modal = $("#search-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "search-modal";
      modal.className = "modal";
      modal.innerHTML =
        '<div class="modal-card">' +
        '  <div class="modal-row">' +
        '    <input id="search-input" type="search" placeholder="Search episodes (title, speakers)..." autocomplete="off" />' +
        '    <button type="button" id="search-close" class="btn">Close</button>' +
        "  </div>" +
        '  <div id="search-status" class="muted"></div>' +
        '  <ul id="search-results" class="list"></ul>' +
        "</div>";
      document.body.appendChild(modal);
      $("#search-close", modal).addEventListener("click", closeSearch);
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeSearch();
      });
    }

    modal.classList.add("open");
    var input = $("#search-input", modal);
    input.value = "";
    input.focus();
    $("#search-status", modal).textContent = "Loading index…";
    $("#search-results", modal).innerHTML = "";

    loadIndex()
      .then(function () {
        $("#search-status", modal).textContent = "Type to search.";
      })
      .catch(function (err) {
        $("#search-status", modal).textContent = String(err || "Index load failed");
      });

    var handler = function () {
      var q = input.value.trim().toLowerCase();
      if (!q) {
        $("#search-status", modal).textContent = "Type to search.";
        $("#search-results", modal).innerHTML = "";
        return;
      }
      var tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
      $("#search-status", modal).textContent = "Searching…";

      loadIndex().then(function (index) {
        var matches = index
          .map(function (e) {
            return { e: e, s: scoreMatch(tokens, e) };
          })
          .filter(function (x) {
            return x.s > 0;
          })
          .sort(function (a, b) {
            return b.s - a.s;
          })
          .slice(0, 50);

        $("#search-status", modal).textContent = matches.length + " results";
        $("#search-results", modal).innerHTML = matches
          .map(function (m) {
            var e = m.e;
            var url = getBasePath() + "podcasts/" + encodeURIComponent(e.f) + "/?e=" + encodeURIComponent(e.k);
            var line = esc(e.ft) + " · " + esc(e.d || "");
            var id = esc(e.f + ":" + e.k);
            return (
              '<li class="episode-row" data-episode-id="' +
              id +
              '">' +
              '<a href="' +
              url +
              '">' +
              esc(e.t) +
              '</a> <span class="muted">(' +
              line +
              ")</span>" +
              '<div class="mini-progress"><div class="mini-progress-bar" data-progress-bar></div></div>' +
              '<div class="mini-progress-text muted" data-progress-text></div>' +
              "</li>"
            );
          })
          .join("");
        refreshAllProgress();
      });
    };

    input.oninput = handler;
  }

  function closeSearch() {
    var modal = $("#search-modal");
    if (modal) modal.classList.remove("open");
  }

  function initSearch() {
    $all("[data-open-search]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openSearch();
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var target = e.target;
        var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        openSearch();
      }
      if (e.key === "Escape") {
        closeSearch();
      }
    });
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
    renderHistoryPanel();
    window.addEventListener("storage", function (e) {
      if (!e || !e.key) return;
      if (String(e.key).startsWith(LS_PREFIX + "p:") || e.key === historyKey()) {
        refreshAllProgress();
        renderHistoryPanel();
      }
    });
  }

  initPlayer();
  initSearch();
  initProgress();
  initDescriptions();
  initPwa();
})();
