/**
 * Session history: playing segments with timestamps.
 * Pause keeps the same segment; changing video makes a new entry.
 */
const STORAGE_KEY = "video_podcasts_history_v1";
const SHORT_THRESHOLD_SEC = 30;

let entries = [];
let current = null;
let subscribers = [];

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    entries = Array.isArray(raw) ? raw : [];
  } catch {
    entries = [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  subscribers.forEach(fn => fn());
}

function videoKey(sourceId, episodeId) {
  return `${sourceId}::${episodeId}`;
}

export function startSegment({ sourceId, episodeId, episodeTitle, channelTitle, startTime }) {
  if (current && videoKey(current.sourceId, current.episodeId) !== videoKey(sourceId, episodeId)) {
    entries.unshift({ ...current });
    save();
  }
  current = {
    sourceId,
    episodeId,
    episodeTitle: episodeTitle || "",
    channelTitle: channelTitle || "",
    start: startTime ?? 0,
    end: startTime ?? 0,
    at: Date.now(),
  };
  subscribers.forEach(fn => fn());
}

export function updateEnd(time) {
  if (current && Number.isFinite(time)) {
    current.end = Math.max(current.start, time);
    subscribers.forEach(fn => fn());
  }
}

export function finalize() {
  if (current) {
    entries.unshift({ ...current });
    save();
    current = null;
    subscribers.forEach(fn => fn());
  }
}

export function getEntries() {
  return [...entries];
}

export function getCurrent() {
  return current ? { ...current } : null;
}

export function clear() {
  entries = [];
  save();
}

export function clearShort(thresholdSec = SHORT_THRESHOLD_SEC) {
  entries = entries.filter(e => (e.end - e.start) >= thresholdSec);
  save();
}

export function combine() {
  if (entries.length < 2) return;
  const out = [];
  let run = null;
  for (const e of entries) {
    const key = videoKey(e.sourceId, e.episodeId);
    if (run && videoKey(run.sourceId, run.episodeId) === key) {
      run.start = Math.min(run.start, e.start);
      run.end = Math.max(run.end, e.end);
    } else {
      run = { ...e };
      out.push(run);
    }
  }
  entries = out;
  save();
}

export function subscribe(fn) {
  subscribers.push(fn);
  return () => { subscribers = subscribers.filter(f => f !== fn); };
}

export function render(container, { onEntryClick, fmtTime }) {
  if (!container) return;
  const $ = (s, el = container) => el.querySelector(s);

  const header = document.createElement("div");
  header.className = "historyHeader";
  header.innerHTML = `
    <span>History</span>
    <div class="historyActions">
      <button class="historyBtn" data-action="combine" title="Combine same video">Combine</button>
      <button class="historyBtn" data-action="clearShort" title="Remove short segments">Clear short</button>
      <button class="historyBtn" data-action="clear" title="Clear all">Clear</button>
      <button class="historyBtn historyBtnClose">✕</button>
    </div>
  `;

  const list = document.createElement("div");
  list.className = "historyList";

  function renderList() {
    list.innerHTML = "";
    const all = getCurrent() ? [getCurrent(), ...getEntries()] : getEntries();
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      const isCurrent = i === 0 && getCurrent();
      const el = document.createElement("div");
      el.className = "historyEntry" + (isCurrent ? " historyEntryCurrent" : "");
      el.dataset.sourceId = e.sourceId;
      el.dataset.episodeId = e.episodeId;
      el.dataset.end = String(e.end);
      const title = (e.episodeTitle || "Episode").slice(0, 50) + ((e.episodeTitle || "").length > 50 ? "…" : "");
      const sub = (e.channelTitle || "").slice(0, 30);
      const range = `${fmtTime(e.start)} → ${fmtTime(e.end)}`;
      el.innerHTML = `
        <div class="historyEntryTitle">${escapeHtml(title)}</div>
        <div class="historyEntrySub">${escapeHtml(sub)} · ${range}</div>
      `;
      el.addEventListener("click", () => {
        if (onEntryClick) onEntryClick(e);
      });
      list.appendChild(el);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  header.querySelector("[data-action=clear]").addEventListener("click", () => {
    clear();
    renderList();
  });
  header.querySelector("[data-action=clearShort]").addEventListener("click", () => {
    clearShort();
    renderList();
  });
  header.querySelector("[data-action=combine]").addEventListener("click", () => {
    combine();
    renderList();
  });

  const unsub = subscribe(renderList);
  renderList();

  container.innerHTML = "";
  container.appendChild(header);
  container.appendChild(list);

  return {
    closeBtn: header.querySelector(".historyBtnClose"),
    destroy: () => { unsub(); },
  };
}

load();
