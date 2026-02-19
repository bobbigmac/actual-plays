import { $, $all, cssEscape, esc } from "./dom.js";
import { LS_PREFIX, lsGet, lsSet } from "./storage.js";
import { qs, setQs } from "./util/url.js";
import { loadHistory, pushHistoryEntry } from "./state/history.js";
import { dequeueNext } from "./state/queue.js";
import { readProgress, writeProgress } from "./state/progress.js";
import { corsOkForUrl, maybeAutoCacheQueue } from "./offline_api.js";
import { parseEpisodeId, readEpisodeMetaFromElement, resolveEpisodeMeta } from "./episode_meta.js";
import { refreshAllProgress, refreshProgressForId, refreshQueueIndicators } from "./ui/episode_dom.js";
import { renderHomePanels } from "./home.js";
import { fmtTime } from "./util/time.js";
import { syncFromStorage } from "./model.js";

export function initPlayer() {
  var player = $("#player");
  if (!player) return null;

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
  var lastPositionStateMs = 0;

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

    function readDb(key, fallback) {
      var raw = lsGet(LS_PREFIX + "eq:" + key);
      if (raw == null) return fallback;
      var v = Number(raw);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(-12, Math.min(12, Math.round(v)));
    }

    var g = readDb("gain", 0);
    var l = readDb("low", 0);
    var m = readDb("mid", 0);
    var h = readDb("high", 0);

    if (gain) gain.value = String(g);
    if (eqLow) eqLow.value = String(l);
    if (eqMid) eqMid.value = String(m);
    if (eqHigh) eqHigh.value = String(h);

    if (gainVal) gainVal.textContent = (g >= 0 ? "+" : "") + g + " dB";
    if (eqLowVal) eqLowVal.textContent = (l >= 0 ? "+" : "") + l + " dB";
    if (eqMidVal) eqMidVal.textContent = (m >= 0 ? "+" : "") + m + " dB";
    if (eqHighVal) eqHighVal.textContent = (h >= 0 ? "+" : "") + h + " dB";

    if (!ensureAudioGraph()) return;
    if (gainNode) gainNode.gain.value = dbToLinear(g);
    if (lowNode) lowNode.gain.value = l;
    if (midNode) midNode.gain.value = m;
    if (highNode) highNode.gain.value = h;
  }

  function setPlayButtonState() {
    if (!btnPlayPause) return;
    btnPlayPause.textContent = player.paused ? "Play" : "Pause";
  }

  function setTimeLabels() {
    if (tElapsed) tElapsed.textContent = fmtTime(player.currentTime || 0);
    if (tDuration) tDuration.textContent = fmtTime(player.duration || 0);
  }

  function setScrubFromPlayer() {
    if (!scrub || scrubbing) return;
    var d = Number(player.duration) || 0;
    if (!(d > 0)) {
      scrub.value = "0";
      return;
    }
    var ratio = Math.max(0, Math.min(1, (player.currentTime || 0) / d));
    scrub.value = String(Math.floor(ratio * 1000));
  }

  function setActiveEpisodeId(id) {
    $("[data-playing]") && $("[data-playing]").removeAttribute("data-playing");
    $all(".episode.is-playing").forEach(function (el) {
      el.classList.remove("is-playing");
    });
    if (!id) return;
    var parsed = parseEpisodeId(id);
    var el = $("#e-" + cssEscape(parsed.episodeKey));
    if (el) {
      el.setAttribute("data-playing", "1");
      el.classList.add("is-playing");
    }
  }

  function updateMediaSession(title, artist, link, artwork) {
    try {
      if (!("mediaSession" in navigator)) return;
      if (!window.MediaMetadata) return;
      var meta = new window.MediaMetadata({
        title: String(title || ""),
        artist: String(artist || ""),
        album: "",
        artwork: artwork
          ? [
              { src: artwork, sizes: "512x512", type: "image/png" },
              { src: artwork, sizes: "256x256", type: "image/png" },
            ]
          : [],
      });
      navigator.mediaSession.metadata = meta;
    } catch (_e) {}
  }

  function setMediaPlaybackState(state) {
    try {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.playbackState = state;
    } catch (_e) {}
  }

  function updatePositionState(force) {
    try {
      if (!("mediaSession" in navigator)) return;
      if (!navigator.mediaSession.setPositionState) return;
      var now = Date.now();
      if (!force && now - lastPositionStateMs < 900) return;
      lastPositionStateMs = now;
      var d = Number(player.duration) || 0;
      var p = Math.max(0, Number(player.currentTime) || 0);
      if (!(d > 0) || !Number.isFinite(d)) return;
      navigator.mediaSession.setPositionState({
        duration: d,
        position: Math.min(d, p),
        playbackRate: Number(player.playbackRate) || 1,
      });
    } catch (_e) {}
  }

  function safeSetActionHandler(action, handler) {
    try {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (_e) {}
  }

  function setupMediaSessionHandlers() {
    if (!("mediaSession" in navigator)) return;

    safeSetActionHandler("play", function () {
      resumeAudioCtx();
      if (player.src) player.play().catch(function () {});
    });
    safeSetActionHandler("pause", function () {
      if (player.src) player.pause();
    });
    safeSetActionHandler("stop", function () {
      if (!player.src) return;
      player.pause();
      try {
        player.currentTime = 0;
      } catch (_e) {}
      saveProgress(true);
      updatePositionState(true);
    });

    safeSetActionHandler("seekbackward", function (details) {
      if (!player.src) return;
      var off = details && typeof details.seekOffset === "number" ? details.seekOffset : 15;
      player.currentTime = Math.max(0, (player.currentTime || 0) - off);
      saveProgress(true);
      updatePositionState(true);
    });
    safeSetActionHandler("seekforward", function (details) {
      if (!player.src) return;
      var off = details && typeof details.seekOffset === "number" ? details.seekOffset : 30;
      player.currentTime = Math.min(player.duration || Infinity, (player.currentTime || 0) + off);
      saveProgress(true);
      updatePositionState(true);
    });
    safeSetActionHandler("seekto", function (details) {
      if (!player.src) return;
      if (!details || typeof details.seekTime !== "number") return;
      var t = Math.max(0, details.seekTime);
      try {
        if (details.fastSeek && typeof player.fastSeek === "function") player.fastSeek(t);
        else player.currentTime = t;
      } catch (_e) {}
      saveProgress(true);
      updatePositionState(true);
    });

    // “Track” is a bit of a lie for podcasts, but these map well to headsets/OS controls.
    safeSetActionHandler("nexttrack", function () {
      var next = dequeueNext();
      syncFromStorage();
      if (next) playMeta(next);
    });
    safeSetActionHandler("previoustrack", function () {
      if (!player.src) return;
      if ((player.currentTime || 0) > 5) {
        player.currentTime = 0;
        saveProgress(true);
        updatePositionState(true);
        return;
      }
      var hist = loadHistory();
      var idx = -1;
      for (var i = 0; i < (hist || []).length; i++) {
        if (hist[i] && hist[i].id === currentEpisodeId) {
          idx = i;
          break;
        }
      }
      if (idx >= 0 && hist[idx + 1] && hist[idx + 1].id) {
        playMeta(hist[idx + 1]);
      } else {
        player.currentTime = 0;
        saveProgress(true);
        updatePositionState(true);
      }
    });
  }

  function saveProgress(force) {
    if (!currentEpisodeId) return;
    var now = Date.now();
    if (!force && now - lastSaveMs < 4500) return;
    lastSaveMs = now;

    var pos = Math.max(0, Number(player.currentTime) || 0);
    var dur = Math.max(0, Number(player.duration) || 0);
    var done = dur > 0 && pos >= Math.max(0, dur - 10);
    writeProgress(currentEpisodeId, pos, dur, done);
    lastSavedPos = pos;

    refreshProgressForId(currentEpisodeId);
    updatePositionState(false);
  }

  function startAutosave() {
    stopAutosave();
    saveTimer = setInterval(function () {
      saveProgress(false);
    }, 5000);
  }

  function stopAutosave() {
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = null;
  }

  function selectMeta(hint, opts) {
    var options = opts || {};
    var autoplay = Boolean(options.autoplay);
    if (!hint || !hint.id) return Promise.resolve(null);

    return resolveEpisodeMeta(hint)
      .then(function (full) {
        if (!full || !full.id) return null;

        currentEpisodeId = full.id;
        currentFeedSlug = full.feedSlug || parseEpisodeId(full.id).feedSlug || null;
        currentMeta = full;
        saveCurrent(full);

        // URL query state (no navigation, just state).
        if (full.episodeKey) setQs("e", full.episodeKey);

        // UI
        setActiveEpisodeId(full.id);
        $("#now-title").textContent = full.t || "Now playing";
        var subtitleParts = [];
        if (full.ft) subtitleParts.push(esc(full.ft));
        if (full.l) subtitleParts.push('<a href="' + esc(full.l) + '" rel="noopener" target="_blank">Episode link</a>');
        if (full.d) subtitleParts.push(esc(full.d));
        $("#now-sub").innerHTML = subtitleParts.join(" · ");

        // Speed restore
        desiredRate = currentFeedSlug ? readSpeedForFeed(currentFeedSlug) : readLastSpeed();
        setSpeed(desiredRate, { persist: false });

        // Progress restore
        var prog = readProgress(full.id) || null;
        lastSavedPos = prog && prog.p ? prog.p : 0;
        pendingSeek = prog && prog.p && (!prog.d || prog.p < Math.max(0, prog.d - 10)) ? prog.p : null;

        // Source
        if (full.a) {
          try {
            if (corsOkForUrl(full.a)) player.crossOrigin = "anonymous";
            else player.removeAttribute("crossorigin");
          } catch (_e) {}
          if (player.src !== full.a) player.src = full.a;
        }

        updateEqAvailabilityUi();
        updateMediaSession(full.t || "", full.ft || "", full.l || "", full.im || "");
        setMediaPlaybackState("paused");
        updatePositionState(true);
        refreshAllProgress();
        renderHomePanels();
        refreshQueueIndicators();

        if (autoplay) {
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
                du: Number(full.du) || 0,
                b: Number(full.b) || 0,
                u: Date.now(),
              });
              syncFromStorage();
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

  var api = {
    playMeta: playMeta,
    selectMeta: function (meta) {
      return selectMeta(meta, { autoplay: false });
    },
    getCurrentId: function () {
      return currentEpisodeId;
    },
    loadCurrent: loadCurrent,
  };

  window.__AP_PLAYER__ = api;
  setupMediaSessionHandlers();

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
      setMediaPlaybackState("paused");
      updatePositionState(true);
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
      lsSet(LS_PREFIX + "eq:" + key, String(db));
      if (!ensureAudioGraph()) return;
      if (key === "gain" && gainNode) gainNode.gain.value = dbToLinear(db);
      if (key === "low" && lowNode) lowNode.gain.value = db;
      if (key === "mid" && midNode) midNode.gain.value = db;
      if (key === "high" && highNode) highNode.gain.value = db;
    });
  }

  bindDbSlider(gain, gainVal, "gain");
  bindDbSlider(eqLow, eqLowVal, "low");
  bindDbSlider(eqMid, eqMidVal, "mid");
  bindDbSlider(eqHigh, eqHighVal, "high");

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
    updatePositionState(true);
  });

  player.addEventListener("ratechange", function () {
    if (!speedReadout) return;
    var r = Number(player.playbackRate) || 1;
    r = Math.round(r * 100) / 100;
    speedReadout.textContent = String(r) + "x";
    updatePositionState(true);
  });

  player.addEventListener("timeupdate", function () {
    setScrubFromPlayer();
    setTimeLabels();
    saveProgress(false);
    updatePositionState(false);
  });

  player.addEventListener("play", function () {
    resumeAudioCtx();
    setPlayButtonState();
    startAutosave();
    setMediaPlaybackState("playing");
    updatePositionState(true);
  });
  player.addEventListener("pause", function () {
    setPlayButtonState();
    saveProgress(true);
    stopAutosave();
    setMediaPlaybackState("paused");
    updatePositionState(true);
  });
  player.addEventListener("ended", function () {
    setPlayButtonState();
    saveProgress(true);
    stopAutosave();
    setMediaPlaybackState("paused");
    updatePositionState(true);
    // Auto-advance the queue if present.
    var next = dequeueNext();
    syncFromStorage();
    if (next) playMeta(next);
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

  return api;
}
