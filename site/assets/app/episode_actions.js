import { $, $all } from "./dom.js";
import { resolveEpisodeMeta, readEpisodeMetaFromElement } from "./episode_meta.js";
import { enqueue, isQueuedId, loadQueue, removeFromQueue, saveQueue } from "./state/queue.js";
import { loadHistory, removeFromHistory, saveHistory } from "./state/history.js";
import { readProgress, writeProgress, writeProgressObj } from "./state/progress.js";
import { toggleOfflineUrl, refreshOfflineStatus, maybeAutoCacheQueue } from "./offline_api.js";
import { syncFromStorage } from "./model.js";

function getPageFeedTitle() {
  var h1 = $("h1");
  return h1 ? h1.textContent : "";
}

export function markPlayed(episodeId) {
  if (!episodeId) return;
  var p = readProgress(episodeId) || { p: 0, d: 0, c: false };
  writeProgress(episodeId, p.p || 0, p.d || 0, true);
  removeFromHistory(episodeId);
  removeFromQueue(episodeId);
  syncFromStorage();
}

export function markUnplayed(episodeId) {
  if (!episodeId) return;
  var p = readProgress(episodeId) || { p: 0, d: 0, u: 0, c: false };
  writeProgressObj(episodeId, { p: p.p || 0, d: p.d || 0, u: Date.now(), c: false });
}

export function markPlayedMany(ids) {
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
  syncFromStorage();
}

export function initEpisodeActions(deps) {
  var playerApi = (deps && deps.playerApi) || null;
  var onChanged = (deps && deps.onChanged) || function () {};

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
      if (meta && !meta.ft) meta.ft = getPageFeedTitle();
      if (playerApi && playerApi.playMeta) playerApi.playMeta(meta);
      return;
    }

    if (action === "open") {
      resolveEpisodeMeta(meta)
        .then(function (full) {
          var url = (full && full.l) || (meta && meta.l) || "";
          if (!url) throw new Error("No link URL");
          try {
            window.open(url, "_blank", "noopener");
          } catch (_e) {
            window.location.href = url;
          }
        })
        .catch(function (e2) {
          console.warn("[open] failed", e2);
        });
      return;
    }

    if (action === "queue") {
      if (isQueuedId(meta.id)) {
        removeFromQueue(meta.id);
        syncFromStorage();
        onChanged();
        maybeAutoCacheQueue({ force: false });
        return;
      }
      if (meta && !meta.ft) meta.ft = getPageFeedTitle();
      resolveEpisodeMeta(meta)
        .then(function (full) {
          if (!full.a) {
            console.warn("[queue] no playable audio enclosure; not queued", full);
            return;
          }
          enqueue({
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
          onChanged();
          maybeAutoCacheQueue({ force: false });
        })
        .catch(function () {});
      return;
    }

    if (action === "remove") {
      removeFromQueue(meta.id);
      syncFromStorage();
      onChanged();
      maybeAutoCacheQueue({ force: false });
      return;
    }

    if (action === "played") {
      var p = readProgress(meta.id);
      if (p && p.c) markUnplayed(meta.id);
      else markPlayed(meta.id);
      onChanged();
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
      onChanged();
      return;
    }

    if (action === "offline") {
      btn.disabled = true;
      var prevText = btn.textContent;
      btn.textContent = "Offline…";
      resolveEpisodeMeta(meta)
        .then(function (full) {
          if (!full.a) throw new Error("No audio URL");
          // Some lists (notably search results) don't include audio/link/image; patch the row so
          // offline state can reflect consistently anywhere this episode is shown.
          try {
            if (row && row.setAttribute) {
              row.setAttribute("data-episode-audio", full.a);
              if (full.l) row.setAttribute("data-episode-link", full.l);
              if (full.im) row.setAttribute("data-episode-image", full.im);
            }
          } catch (_e) {}
          return toggleOfflineUrl(full.a);
        })
        .then(function () {
          onChanged();
          return refreshOfflineStatus();
        })
        .catch(function (e2) {
          console.warn("[offline] toggle failed", e2);
          btn.textContent = prevText || "Offline";
        })
        .finally(function () {
          btn.disabled = false;
        });
      return;
    }
  });
}
