import { createStore } from "./store.js";
import { LS_PREFIX, lsGet, lsSet } from "./storage.js";
import { loadHistory } from "./state/history.js";
import { getQueueSet, invalidateQueueSet, loadQueue } from "./state/queue.js";

function prefKey(name) {
  return LS_PREFIX + "pref:" + String(name || "");
}

export function readBrowseShowSupplemental() {
  return lsGet(prefKey("browse.showSupplemental")) === "1";
}

export function writeBrowseShowSupplemental(next) {
  lsSet(prefKey("browse.showSupplemental"), next ? "1" : "0");
}

export function readLatestShowSupplemental() {
  return lsGet(prefKey("latest.showSupplemental")) === "1";
}

export function writeLatestShowSupplemental(next) {
  lsSet(prefKey("latest.showSupplemental"), next ? "1" : "0");
}

function computeQueueIds(queue) {
  var out = {};
  (queue || []).forEach(function (it) {
    if (it && it.id) out[String(it.id)] = true;
  });
  return out;
}

export var store = createStore({
  history: loadHistory(),
  queue: loadQueue(),
  queueIds: computeQueueIds(loadQueue()),
  offline: {
    status: null,
    jobsByUrl: {},
    audioCachedByUrl: {},
  },
});

export function syncFromStorage() {
  invalidateQueueSet();
  var q = loadQueue();
  store.update(
    {
      history: loadHistory(),
      queue: q,
      queueIds: computeQueueIds(q),
    },
    { type: "storage-sync" }
  );
}

export function setOfflineStatus(status) {
  store.update(
    {
      offline: {
        status: status || null,
        jobsByUrl: (store.getState().offline && store.getState().offline.jobsByUrl) || {},
        audioCachedByUrl: (store.getState().offline && store.getState().offline.audioCachedByUrl) || {},
      },
    },
    { type: "offline-status" }
  );
}

export function setOfflineJob(url, job) {
  var st = store.getState();
  var offline = st.offline || { status: null, jobsByUrl: {}, audioCachedByUrl: {} };
  var nextJobs = {};
  Object.keys(offline.jobsByUrl || {}).forEach(function (k) {
    nextJobs[k] = offline.jobsByUrl[k];
  });
  if (job) nextJobs[String(url)] = job;
  else delete nextJobs[String(url)];

  store.update(
    {
      offline: {
        status: offline.status || null,
        jobsByUrl: nextJobs,
        audioCachedByUrl: offline.audioCachedByUrl || {},
      },
    },
    { type: "offline-job", url: String(url || "") }
  );
}

export function setAudioCached(url, cached) {
  var st = store.getState();
  var offline = st.offline || { status: null, jobsByUrl: {}, audioCachedByUrl: {} };
  var next = {};
  Object.keys(offline.audioCachedByUrl || {}).forEach(function (k) {
    next[k] = offline.audioCachedByUrl[k];
  });
  next[String(url)] = Boolean(cached);
  store.update(
    {
      offline: {
        status: offline.status || null,
        jobsByUrl: offline.jobsByUrl || {},
        audioCachedByUrl: next,
      },
    },
    { type: "offline-cached", url: String(url || "") }
  );
}

export function setAudioCachedIndex(urls) {
  var st = store.getState();
  var offline = st.offline || { status: null, jobsByUrl: {}, audioCachedByUrl: {} };
  var next = {};
  (urls || []).forEach(function (u) {
    if (!u) return;
    next[String(u)] = true;
  });
  store.update(
    {
      offline: {
        status: offline.status || null,
        jobsByUrl: offline.jobsByUrl || {},
        audioCachedByUrl: next,
      },
    },
    { type: "offline-cached-index" }
  );
}

export function refreshQueueIdsFromModuleCache() {
  // Optional: sync from the queue module's computed set (it is derived from storage anyway).
  try {
    var set = getQueueSet();
    var ids = {};
    set.forEach(function (id) {
      ids[String(id)] = true;
    });
    store.update(
      {
        queueIds: ids,
      },
      { type: "queue-ids" }
    );
  } catch (_e) {}
}
