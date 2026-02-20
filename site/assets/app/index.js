import { initDataPanel } from "./data_panel.js";
import { $, $all } from "./dom.js";
import { initDescriptions } from "./ui/descriptions.js";
import { initHeaderOffset } from "./ui/header_offset.js";
import { initMenus } from "./ui/menus.js";
import { initSpaNavigation } from "./navigation.js";
import { initPwa } from "./pwa.js";
import { initPlayer } from "./player.js";
import { initSearch } from "./search.js";
import { applySpeakersUi, initSpeakersUi } from "./ui/speakers.js";
import { initEpisodeActions } from "./episode_actions.js";
import { store, syncFromStorage } from "./model.js";
import { refreshAllProgress, refreshOfflineIndicators, refreshQueueIndicators } from "./ui/episode_dom.js";
import { renderHomePanels } from "./home.js";
import { initLazyImages } from "./ui/lazy_images.js";
import { initCopyUi } from "./ui/copy.js";
import { initShareUi } from "./ui/share.js";
import { initHomeViews } from "./ui/home_views.js";
import { applyBrowseSupplementalUi, initBrowseSupplementalUi } from "./ui/browse_supplemental.js";
import { applyLatestSupplementalUi, initLatestSupplementalUi } from "./ui/latest_supplemental.js";
import { initGraph } from "./graph.js";
import { loadHistory, saveHistory } from "./state/history.js";
import { loadQueue, saveQueue } from "./state/queue.js";
import { readProgress, writeProgressObj } from "./state/progress.js";
import {
  maybeAutoCacheQueue,
  refreshOfflineStatus,
  readOfflineSettings,
  syncAudioCacheIndex,
  writeOfflineSettings,
} from "./offline_api.js";
import { getBasePath } from "./env.js";
import { lsGet, lsSet, LS_PREFIX } from "./storage.js";

(function () {
  var lazyImages = initLazyImages();
  var lastDebugCssHref = "";

  function closeData() {
    var modal = $("#data-modal");
    if (modal) modal.classList.remove("open");
  }

  function maybeDebugCss() {
    // Debug helper: add `?ap_debug_css=1` to any URL.
    // Logs matched rules + computed styles for the speaker hero section.
    try {
      var params = new URLSearchParams(String(window.location.search || ""));
      if (!params.has("ap_debug_css")) return;
      if (String(window.location.href || "") === lastDebugCssHref) return;
      lastDebugCssHref = String(window.location.href || "");

      function walkRules(ruleList, out, href) {
        if (!ruleList) return;
        for (var i = 0; i < ruleList.length; i++) {
          var r = ruleList[i];
          if (!r) continue;
          // Grouping rules (media/supports/layer) expose `cssRules`.
          if (r.cssRules) {
            // If it's a media rule, only descend when it matches.
            try {
              if (r.media && r.media.mediaText) {
                if (!window.matchMedia(String(r.media.mediaText)).matches) continue;
              }
            } catch (_e) {}
            // If it's a supports rule, only descend when it matches.
            try {
              if (typeof r.conditionText === "string" && window.CSS && CSS.supports) {
                if (!CSS.supports(r.conditionText)) continue;
              }
            } catch (_e2) {}
            walkRules(r.cssRules, out, href);
            continue;
          }

          // Style rule.
          if (r.type !== 1) continue;
          var sel = r.selectorText;
          if (!sel) continue;
          out.push({ href: href, selector: String(sel), style: r.style });
        }
      }

      function inspect(sel, prop) {
        var el = document.querySelector(sel);
        if (!el) {
          console.log("[ap_debug_css] missing element", sel);
          return;
        }
        var computed = "";
        try {
          computed = String(getComputedStyle(el).getPropertyValue(prop) || "").trim();
        } catch (_e) {}

        var inlineVal = "";
        try {
          inlineVal = String(el.style && el.style.getPropertyValue(prop) || "").trim();
        } catch (_e2) {}

        var matched = [];
        for (var i = 0; i < document.styleSheets.length; i++) {
          var ss = document.styleSheets[i];
          var href = "";
          try {
            href = ss && ss.href ? String(ss.href) : "[inline]";
          } catch (_e3) {
            href = "[unknown]";
          }
          var rules;
          try {
            rules = ss && ss.cssRules ? ss.cssRules : null;
          } catch (e) {
            // e.g. cross-origin stylesheet or blocked
            matched.push({ href: href, selector: "[unreadable stylesheet]", value: "", important: "", error: String(e || "") });
            continue;
          }
          var flat = [];
          walkRules(rules, flat, href);
          for (var j = 0; j < flat.length; j++) {
            var fr = flat[j];
            var ok = false;
            try {
              ok = el.matches(fr.selector);
            } catch (_e4) {}
            if (!ok) continue;
            try {
              var v = String(fr.style.getPropertyValue(prop) || "").trim();
              if (!v) continue;
              matched.push({
                href: fr.href,
                selector: fr.selector,
                value: v,
                important: String(fr.style.getPropertyPriority(prop) || ""),
              });
            } catch (_e5) {}
          }
        }

        console.log("[ap_debug_css]", sel, prop, { computed: computed, inline: inlineVal, matched: matched });
      }

      console.log("[ap_debug_css] href", String(window.location.href || ""));
      inspect(".speaker-hero-row", "display");
      inspect(".speaker-hero-media", "max-width");
      inspect(".speaker-hero-media img", "height");
    } catch (_e) {}
  }

  function refreshUi() {
    refreshAllProgress();
    applyBrowseSupplementalUi();
    applyLatestSupplementalUi();
    renderHomePanels();
    refreshQueueIndicators();
    refreshOfflineIndicators(store.getState());
    applySpeakersUi();
    if (lazyImages && lazyImages.refreshSoon) lazyImages.refreshSoon(document);
    maybeDebugCss();
  }

  function initProgressSync() {
    syncFromStorage();
    refreshUi();

    // Offline status text + store update.
    refreshOfflineStatus().catch(function () {});
    syncAudioCacheIndex()
      .then(function () {
        refreshOfflineIndicators(store.getState());
      })
      .catch(function () {});

    window.addEventListener("storage", function (e) {
      if (!e || !e.key) return;
      if (String(e.key).startsWith(LS_PREFIX + "p:") || String(e.key).startsWith(LS_PREFIX)) {
        syncFromStorage();
        refreshUi();
      }
    });

    // Store-driven updates (mainly offline job/cached state).
    store.subscribe(function (state, info) {
      if (!info || !info.type) return;
      if (String(info.type).startsWith("offline")) {
        refreshOfflineIndicators(state);
      }
    });
  }

  initHeaderOffset();

  var playerApi = initPlayer();

  var searchApi = initSearch({
    playMeta: function (meta) {
      if (playerApi && playerApi.playMeta) playerApi.playMeta(meta);
    },
    closeData: closeData,
    onResultsRendered: function () {
      refreshAllProgress();
      refreshQueueIndicators();
      refreshOfflineIndicators(store.getState());
      if (lazyImages && lazyImages.refreshSoon) lazyImages.refreshSoon(document);
    },
  });

  initBrowseSupplementalUi({ onChanged: refreshUi });
  initLatestSupplementalUi({ onChanged: refreshUi });
  initProgressSync();
  initDescriptions();
  initEpisodeActions({
    playerApi: playerApi,
    onChanged: refreshUi,
  });
  initCopyUi();
  initShareUi();
  initHomeViews();
  initGraph();
  initMenus();
  initSpaNavigation({
    closeData: closeData,
    closeSearchPanel: function () {
      if (searchApi && searchApi.close) searchApi.close();
    },
    onAfterNavigate: function () {
      refreshUi();
      if (searchApi && searchApi.ensure) searchApi.ensure();
      initHomeViews();
      initBrowseSupplementalUi({ onChanged: refreshUi });
      initLatestSupplementalUi({ onChanged: refreshUi });
      initGraph();
    },
  });
  initDataPanel({
    $: $,
    $all: $all,
    LS_PREFIX: LS_PREFIX,
    lsGet: lsGet,
    lsSet: lsSet,
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
    getBasePath: getBasePath,
  });
  initPwa();
  if (searchApi && searchApi.ensure) searchApi.ensure();
  initSpeakersUi();
  if (lazyImages && lazyImages.refresh) lazyImages.refresh(document);

  window.addEventListener("load", function () {
    // Auto-offline queue (if enabled) should run after the page is settled.
    setTimeout(function () {
      maybeAutoCacheQueue({ force: false }).catch(function () {});
    }, 900);
  });
})();
