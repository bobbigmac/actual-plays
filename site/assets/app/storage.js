export var LS_PREFIX = "ap.v1.";

export function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_e) {
    return null;
  }
}

export function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_e) {}
}

