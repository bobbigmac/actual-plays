import { $, $all, esc } from "./dom.js";
import { getBasePath } from "./env.js";
import { parseEpisodeId } from "./episode_meta.js";
import { loadHistory } from "./state/history.js";
import { loadQueue } from "./state/queue.js";
import { readProgress } from "./state/progress.js";
import { artHtml } from "./ui/art.js";
import { fmtBytes } from "./util/bytes.js";
import { fmtTime } from "./util/time.js";

export function isHomePage() {
  var base = new URL(getBasePath(), window.location.origin);
  var p = window.location.pathname;
  return p === base.pathname || p === base.pathname + "index.html";
}

function updateHomeViewBadges(counts) {
  var c = counts || {};
  ["browse", "latest", "history", "queue"].forEach(function (k) {
    var el = document.querySelector('[data-home-view-badge="' + k + '"]');
    if (!el) return;
    var v = Number(c[k]) || 0;
    el.textContent = String(v);
  });
}

export function renderHomePanels() {
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
        encodeURIComponent(parsed.feedSlug) +
        "/?e=" +
        encodeURIComponent(parsed.episodeKey);
      var bits = [];
      if (it.ft) bits.push(esc(it.ft));
      if (it.d) bits.push(esc(it.d));
      if (Number(it.du) > 0) bits.push(esc(fmtTime(it.du)));
      bits.push(esc(fmtBytes(it.b)));
      var meta = bits.join(" · ");
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
        '" data-episode-duration="' +
        esc(String(it.du || "")) +
        '" data-episode-bytes="' +
        esc(String(it.b || "")) +
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
        encodeURIComponent(parsed.feedSlug) +
        "/?e=" +
        encodeURIComponent(parsed.episodeKey);
      var bits = [];
      if (it.ft) bits.push(esc(it.ft));
      if (it.d) bits.push(esc(it.d));
      if (Number(it.du) > 0) bits.push(esc(fmtTime(it.du)));
      bits.push(esc(fmtBytes(it.b)));
      var meta = bits.join(" · ");
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
        '" data-episode-duration="' +
        esc(String(it.du || "")) +
        '" data-episode-bytes="' +
        esc(String(it.b || "")) +
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

  var browseCount = document.querySelectorAll('[data-home-view="browse"] .feed-card:not([hidden])').length;
  var latestVisible = items.filter(function (el) {
    return el && !el.hasAttribute("hidden");
  }).length;
  updateHomeViewBadges({
    browse: browseCount,
    latest: latestVisible,
    history: visible.length,
    queue: q.length,
  });
}
