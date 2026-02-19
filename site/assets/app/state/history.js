import { LS_PREFIX, lsGet, lsSet } from "../storage.js";

export function historyKey() {
  return LS_PREFIX + "history";
}

export function loadHistory() {
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

export function saveHistory(items) {
  lsSet(historyKey(), JSON.stringify((items || []).slice(0, 200)));
}

export function pushHistoryEntry(entry) {
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

export function removeFromHistory(episodeId) {
  var items = loadHistory();
  var next = items.filter(function (it) {
    return it && it.id !== episodeId;
  });
  saveHistory(next);
}

