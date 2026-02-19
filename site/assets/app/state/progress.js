import { LS_PREFIX, lsGet, lsSet } from "../storage.js";

export function progressKey(episodeId) {
  return LS_PREFIX + "p:" + episodeId;
}

export function readProgress(episodeId) {
  var raw = lsGet(progressKey(episodeId));
  if (!raw) return null;
  try {
    var obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return {
      p: Number(obj.p) || 0,
      d: Number(obj.d) || 0,
      u: Number(obj.u) || 0,
      c: Boolean(obj.c),
    };
  } catch (_e) {
    return null;
  }
}

export function writeProgress(episodeId, p, d, c) {
  var payload = {
    p: Math.max(0, Math.floor(Number(p) || 0)),
    d: Math.max(0, Math.floor(Number(d) || 0)),
    u: Date.now(),
    c: Boolean(c),
  };
  lsSet(progressKey(episodeId), JSON.stringify(payload));
}

export function writeProgressObj(episodeId, obj) {
  if (!episodeId) return;
  if (!obj || typeof obj !== "object") return;
  var payload = {
    p: Math.max(0, Math.floor(Number(obj.p) || 0)),
    d: Math.max(0, Math.floor(Number(obj.d) || 0)),
    u: Math.max(0, Math.floor(Number(obj.u) || 0)),
    c: Boolean(obj.c),
  };
  if (!payload.u) payload.u = Date.now();
  lsSet(progressKey(episodeId), JSON.stringify(payload));
}

