import { $, esc } from "./dom.js";
import { getBasePath } from "./env.js";
import { readEpisodeMetaFromElement } from "./episode_meta.js";
import { readProgress } from "./state/progress.js";
import { artHtml } from "./ui/art.js";
import { toastNetworkFailure } from "./ui/toast.js";
import { fmtBytes } from "./util/bytes.js";
import { fmtTime } from "./util/time.js";
import { joinPath, qs, setQs } from "./util/url.js";

export function initSearch(deps) {
  var playMeta = (deps && deps.playMeta) || function () {};
  var closeData = (deps && deps.closeData) || function () {};
  var onResultsRendered = (deps && deps.onResultsRendered) || function () {};

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
      playMeta(meta);
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
            var url = joinPath(basePath, encodeURIComponent(e.f) + "/?e=" + encodeURIComponent(e.k));
            var parts = [esc(e.ft), esc(e.d || "")];
            if (Number(e.du) > 0) parts.push(esc(fmtTime(e.du)));
            parts.push(esc(fmtBytes(e.b)));
            var line = parts.filter(Boolean).join(" · ");
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
              '" data-episode-duration="' +
              esc(String(e.du || "")) +
              '" data-episode-bytes="' +
              esc(String(e.b || "")) +
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
        onResultsRendered();
      }).catch(function (e2) {
        console.warn("[search] index load failed", e2);
        toastNetworkFailure("Search");
        status.textContent = "Search unavailable (index.json failed to load).";
        results.innerHTML = "";
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

    searchUi = {
      root: root,
      input: input,
      results: results,
      status: status,
      includePlayed: includePlayed,
      playedNormal: playedNormal,
      handler: handler,
    };
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

  function initListeners() {
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

  initListeners();

  return {
    ensure: ensureSearchUi,
    open: openSearchPanel,
    close: closeSearchPanel,
  };
}
