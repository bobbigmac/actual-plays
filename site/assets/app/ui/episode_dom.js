import { $all, cssEscape } from "../dom.js";
import { readProgress } from "../state/progress.js";
import { getQueueSet, invalidateQueueSet } from "../state/queue.js";
import { fmtTime } from "../util/time.js";

export function computeProgressUi(progress) {
  if (!progress) return { pct: 0, text: "" };
  if (progress.c) return { pct: 100, text: "Done" };
  if (progress.d > 0 && progress.p > 0) {
    var pct = Math.max(0, Math.min(100, Math.floor((progress.p / progress.d) * 100)));
    return { pct: pct, text: fmtTime(progress.p) + " / " + fmtTime(progress.d) };
  }
  if (progress.p > 0) return { pct: 0, text: fmtTime(progress.p) };
  return { pct: 0, text: "" };
}

export function updateProgressElement(el) {
  var id = el && el.getAttribute ? el.getAttribute("data-episode-id") : null;
  if (!id) return;
  var progress = readProgress(id);
  var ui = computeProgressUi(progress);
  var bar = el.querySelector ? el.querySelector("[data-progress-bar]") : null;
  var text = el.querySelector ? el.querySelector("[data-progress-text]") : null;
  if (bar) bar.style.width = ui.pct + "%";
  if (text) text.textContent = ui.text;

  var btn = el.querySelector ? el.querySelector('[data-action="played"]') : null;
  if (btn) btn.textContent = progress && progress.c ? "Mark unplayed" : "Mark played";
}

export function refreshAllProgress(root) {
  $all("[data-episode-id]", root || document).forEach(function (el) {
    updateProgressElement(el);
  });
}

export function refreshProgressForId(episodeId, root) {
  var sel = '[data-episode-id="' + cssEscape(episodeId) + '"]';
  $all(sel, root || document).forEach(function (el) {
    updateProgressElement(el);
  });
}

export function refreshQueueIndicators(root) {
  invalidateQueueSet();
  var set = getQueueSet();

  $all("[data-episode-id]", root || document).forEach(function (row) {
    var id = row.getAttribute("data-episode-id") || "";
    if (!id) return;
    row.classList.toggle("is-queued", set.has(id));
  });

  $all('[data-action="queue"]', root || document).forEach(function (btn) {
    var row = btn.closest ? btn.closest("[data-episode-id]") : null;
    var id = row ? row.getAttribute("data-episode-id") : "";
    var queued = id ? set.has(id) : false;
    btn.classList.toggle("queued", queued);
    btn.setAttribute("aria-pressed", queued ? "true" : "false");
    btn.textContent = "Queue";
  });
}

export function refreshOfflineIndicators(state, root) {
  var st = state || {};
  var offline = st.offline || {};
  var jobs = offline.jobsByUrl || {};
  var cachedByUrl = offline.audioCachedByUrl || {};

  $all('[data-action="offline"]', root || document).forEach(function (btn) {
    var row = btn.closest ? btn.closest("[data-episode-id]") : null;
    var url = row ? row.getAttribute("data-episode-audio") || "" : "";
    if (!url) {
      btn.disabled = false;
      btn.classList.remove("offline-busy");
      btn.classList.remove("offline-cached");
      btn.textContent = "Offline";
      btn.removeAttribute("title");
      return;
    }

    var job = jobs[String(url)] || null;
    var busy = Boolean(job && job.stage === "active");
    var cached = Boolean(cachedByUrl[String(url)]);

    btn.disabled = busy;
    btn.classList.toggle("offline-busy", busy);
    btn.classList.toggle("offline-cached", cached);
    btn.textContent = busy ? "Offline…" : cached ? "Offline ✓" : "Offline";
    if (busy) btn.setAttribute("title", "Caching for offline…");
    else btn.removeAttribute("title");
  });
}
