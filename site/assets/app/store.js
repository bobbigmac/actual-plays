export function createStore(initialState) {
  var state = initialState || {};
  var listeners = new Set();
  var batchDepth = 0;
  var batchPrev = null;
  var batchMeta = null;

  function getState() {
    return state;
  }

  function notify(prev, meta) {
    listeners.forEach(function (fn) {
      try {
        fn(state, prev, meta || null);
      } catch (_e) {}
    });
  }

  function setState(updater, meta) {
    var prev = state;
    var next = typeof updater === "function" ? updater(prev) : updater;
    if (!next || typeof next !== "object") return;
    if (next === prev) return;
    state = next;

    if (batchDepth > 0) {
      if (!batchPrev) batchPrev = prev;
      batchMeta = meta || batchMeta;
      return;
    }
    notify(prev, meta);
  }

  function update(patch, meta) {
    setState(function (prev) {
      var next = {};
      Object.keys(prev || {}).forEach(function (k) {
        next[k] = prev[k];
      });
      Object.keys(patch || {}).forEach(function (k2) {
        next[k2] = patch[k2];
      });
      return next;
    }, meta);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return function () {
      listeners.delete(fn);
    };
  }

  function batch(fn, meta) {
    batchDepth += 1;
    if (batchDepth === 1) {
      batchPrev = null;
      batchMeta = meta || null;
    }
    try {
      fn();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0 && batchPrev) {
        var prev = batchPrev;
        var m = batchMeta;
        batchPrev = null;
        batchMeta = null;
        notify(prev, m);
      }
    }
  }

  return { getState: getState, setState: setState, update: update, subscribe: subscribe, batch: batch };
}

