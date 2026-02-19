import { LS_PREFIX, lsGet, lsSet } from "../storage.js";

export function queueKey() {
  return LS_PREFIX + "queue";
}

var queueSet = null;

export function invalidateQueueSet() {
  queueSet = null;
}

export function loadQueue() {
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

export function saveQueue(items) {
  lsSet(queueKey(), JSON.stringify((items || []).slice(0, 200)));
  queueSet = null;
}

export function getQueueSet() {
  if (queueSet) return queueSet;
  var q = loadQueue();
  queueSet = new Set(
    q
      .map(function (it) {
        return it && it.id;
      })
      .filter(Boolean)
  );
  return queueSet;
}

export function isQueuedId(episodeId) {
  if (!episodeId) return false;
  return getQueueSet().has(episodeId);
}

export function enqueue(entry) {
  if (!entry || !entry.id) return;
  var q = loadQueue();
  for (var i = 0; i < q.length; i++) {
    if (q[i] && q[i].id === entry.id) return;
  }
  q.push(entry);
  saveQueue(q);
}

export function dequeueNext() {
  var q = loadQueue();
  if (!q.length) return null;
  var next = q.shift();
  saveQueue(q);
  return next;
}

export function removeFromQueue(episodeId) {
  var q = loadQueue();
  var next = q.filter(function (it) {
    return it && it.id !== episodeId;
  });
  saveQueue(next);
}
