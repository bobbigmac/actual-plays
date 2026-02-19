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

  function closeData() {
    var modal = $("#data-modal");
    if (modal) modal.classList.remove("open");
  }

  function refreshUi() {
    refreshAllProgress();
    renderHomePanels();
    refreshQueueIndicators();
    refreshOfflineIndicators(store.getState());
    applySpeakersUi();
    if (lazyImages && lazyImages.refreshSoon) lazyImages.refreshSoon(document);
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

  initProgressSync();
  initDescriptions();
  initEpisodeActions({
    playerApi: playerApi,
    onChanged: refreshUi,
  });
  initMenus();
  initSpaNavigation({
    closeData: closeData,
    closeSearchPanel: function () {
      if (searchApi && searchApi.close) searchApi.close();
    },
    onAfterNavigate: function () {
      refreshUi();
      if (searchApi && searchApi.ensure) searchApi.ensure();
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
