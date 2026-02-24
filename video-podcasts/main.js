const $ = (s, el = document) => el.querySelector(s);

import * as history from "./history.js";
import { fetchCached } from "./feed-cache.js";

const STORAGE_KEY = "video_podcasts_v1";
const SOURCES_URL = "./video-sources.json";
const FEED_PROXY = "/__feed?url=";
const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.debug("[video-podcasts]", ...args); };

const LOG_MAX = 200;
const logEntries = [];

function log(msg, level = "info") {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const entry = { ts, msg: String(msg), level };
  logEntries.push(entry);
  if (logEntries.length > LOG_MAX) logEntries.shift();
  const el = $("#logOutput");
  if (!el) return;
  const div = document.createElement("div");
  div.className = `logEntry ${level}`;
  div.textContent = `[${ts}] ${msg}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

const video = $("#video");
const guideBar = $("#guideBar");
const btnSeekBack = $("#btnSeekBack");
const btnSeekFwd = $("#btnSeekFwd");
const guideSeek = $("#guideSeek");
const guideSeekFill = $("#guideSeekFill");
const btnChannel = $("#btnChannel");
const guideNow = $("#guideNow");
const btnRandom = $("#btnRandom");
const btnCC = $("#btnCC");
const btnPlay = $("#btnPlay");
const guideTime = $("#guideTime");
const btnSleep = $("#btnSleep");
const sleepMenu = $("#sleepMenu");
const progress = $("#progress");
const progressFill = $("#progressFill");
const guidePanel = $("#guidePanel");
const guideFeeds = $("#guideFeeds");
const guideEpisodes = $("#guideEpisodes");
const btnCloseGuide = $("#btnCloseGuide");
const btnTheme = $("#btnTheme");
const htmlRoot = $("#htmlRoot");
const detailsPanel = $("#detailsPanel");
const btnHistory = $("#btnHistory");
const historyPanel = $("#historyPanel");
const historyPanelContent = $("#historyPanelContent");
const btnDetails = $("#btnDetails");
const btnCloseDetails = $("#btnCloseDetails");
const epTitle = $("#epTitle");
const epSub = $("#epSub");
const epDesc = $("#epDesc");
const chaptersEl = $("#chapters");
const logOutput = $("#logOutput");
const btnClearLog = $("#btnClearLog");

let sources = [];
let sourcesFlat = [];
let currentSource = null;
let episodes = [];
let currentEp = null;
let episodesBySource = {};
let guideFocusSourceIdx = 0;
let guideFocusEpIdx = 0;
let guideObserver = null;
let guideLoadingSources = new Set();
let hls = null;
let lastPersistMs = 0;
let userPaused = false;
let userHasInteracted = false;
let sleepEndAt = null;
let sleepTickId = null;
let guideBarIdleTo = null;
let historyCloseTo = null;

const GUIDE_IDLE_MS = 3000;
const HISTORY_CLOSE_MS = 10000;
const THEMES = ["modern", "dos"];

const state = loadState();

function resetGuideBarIdle() {
  guideBarIdleTo = Date.now() + GUIDE_IDLE_MS;
  guideBar?.classList.remove("idle");
}

function recordInteraction() {
  userHasInteracted = true;
  if (video.muted) video.muted = false;
  if (currentEp?.media?.url && !userPaused) video.play().catch(() => {});
  resetGuideBarIdle();
  if (historyPanel?.getAttribute("aria-hidden") === "false") {
    historyCloseTo = Date.now() + HISTORY_CLOSE_MS;
  }
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object") return {};
    return raw;
  } catch {
    return {};
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return "00:00";
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  if (hh > 0) return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function episodeKey(sourceId, episodeId) {
  return `${sourceId}::${episodeId}`;
}

function getProgressSec(sourceId, episodeId) {
  const k = episodeKey(sourceId, episodeId);
  const v = state.progress?.[k];
  return Number.isFinite(v) ? v : (Number.isFinite(v?.t) ? v.t : 0);
}

function setProgressSec(sourceId, episodeId, t) {
  state.progress ||= {};
  state.progress[episodeKey(sourceId, episodeId)] = Math.max(0, t || 0);
  state.last = { sourceId, episodeId, at: Date.now() };
  saveState();
}

function isProbablyHls(url, mime) {
  const u = String(url || "").toLowerCase();
  const t = String(mime || "").toLowerCase();
  if (u.includes(".m3u8")) return true;
  if (t.includes("application/vnd.apple.mpegurl")) return true;
  if (t.includes("application/x-mpegurl")) return true;
  return false;
}

function isNativeHls() {
  const can = video.canPlayType("application/vnd.apple.mpegurl") || video.canPlayType("application/x-mpegURL");
  return can === "probably" || can === "maybe";
}

let transcriptBlobUrls = [];

function teardownPlayer() {
  transcriptBlobUrls.forEach(u => URL.revokeObjectURL(u));
  transcriptBlobUrls = [];
  [...video.querySelectorAll("track")].forEach(t => t.remove());
  if (hls) {
    try { hls.destroy(); } catch {}
    hls = null;
  }
  video.pause();
  video.removeAttribute("src");
  try { video.load(); } catch {}
}

function normalizeWhitespace(s) {
  return String(s ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(n => n.remove());
  doc.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if (n === "style") el.removeAttribute(a.name);
    });
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer");
    }
  });
  return doc.body.innerHTML;
}

function textFromXml(el) {
  return el ? normalizeWhitespace(el.textContent || "") : "";
}

function attr(el, name) {
  return el?.getAttribute?.(name) ?? "";
}

function parseTimeToSeconds(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Number(s));
  const parts = s.split(":").map(x => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  const [a, b, c] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  return Math.max(0, a * 3600 + b * 60 + c);
}

async function fetchText(url, fetchVia = "auto", { useCache = false } = {}) {
  const u = String(url || "");
  const isRemote = /^https?:\/\//i.test(u);
  const via = fetchVia === "auto" ? (isRemote ? "proxy" : "direct") : fetchVia;
  const finalUrl = (via === "proxy" && isRemote) ? (FEED_PROXY + encodeURIComponent(u)) : u;
  if (useCache && isRemote) {
    return fetchCached(finalUrl);
  }
  const res = await fetch(finalUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return await res.text();
}

function pickBestEnclosure(cands) {
  const norm = cands
    .map(c => ({
      url: c.url || "",
      type: (c.type || "").toLowerCase(),
    }))
    .filter(c => c.url);

  const score = (c) => {
    const u = c.url.toLowerCase();
    const t = c.type;
    let s = 0;
    if (t.startsWith("video/")) s += 50;
    if (u.includes(".m3u8")) s += 45;
    if (u.match(/\.(mp4|m4v|mov|webm)(\?|$)/)) s += 40;
    if (t.includes("mpegurl")) s += 35;
    if (t.startsWith("audio/")) s += 5;
    return s;
  };

  norm.sort((a, b) => score(b) - score(a));
  const best = norm[0] || null;
  const hasVideo = norm.some(c => c.type.startsWith("video/") || c.url.toLowerCase().includes(".m3u8") || /\.(mp4|m4v|mov|webm)(\?|$)/.test(c.url.toLowerCase()));
  const isVideo = best && (best.type.startsWith("video/") || best.url.toLowerCase().includes(".m3u8") || /\.(mp4|m4v|mov|webm)(\?|$)/.test(best.url.toLowerCase()));
  return best ? { ...best, hasVideoInFeed: hasVideo, pickedIsVideo: isVideo } : null;
}

function parseFeed(xmlText, source) {
  let xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) {
    xml = new DOMParser().parseFromString(xmlText, "text/html");
  }
  const isAtom = !!xml.querySelector("feed > entry");

  const channelTitle =
    textFromXml(xml.querySelector("channel > title")) ||
    textFromXml(xml.querySelector("feed > title")) ||
    source.title ||
    source.id;

  const items = isAtom ? [...xml.querySelectorAll("feed > entry")] : [...xml.querySelectorAll("channel > item")];

  const parsed = [];
  const stats = { itemCount: items.length, videoPicked: 0, audioPicked: 0, noMedia: 0 };
  let idx = 0;
  for (const item of items) {
    const title = textFromXml(item.querySelector("title")) || "(untitled)";
    const guid = textFromXml(item.querySelector("guid")) || textFromXml(item.querySelector("id"));
    const link =
      attr(item.querySelector("link[rel='alternate']"), "href") ||
      textFromXml(item.querySelector("link")) ||
      attr(item.querySelector("link"), "href") ||
      "";
    const dateStr =
      textFromXml(item.querySelector("pubDate")) ||
      textFromXml(item.querySelector("published")) ||
      textFromXml(item.querySelector("updated")) ||
      "";
    const date = dateStr ? new Date(dateStr) : null;
    const desc =
      textFromXml(item.querySelector("content\\:encoded")) ||
      textFromXml(item.querySelector("description")) ||
      textFromXml(item.querySelector("summary")) ||
      "";
    const durationRaw = textFromXml(item.querySelector("itunes\\:duration")) || attr(item.querySelector("itunes\\:duration"), "value") || "";
    const durationSec = parseTimeToSeconds(durationRaw);

    const enclosures = [];
    if (isAtom) {
      item.querySelectorAll("link[rel='enclosure']").forEach(l => {
        enclosures.push({ url: attr(l, "href"), type: attr(l, "type") });
      });
    } else {
      item.querySelectorAll("enclosure").forEach(e => {
        enclosures.push({ url: attr(e, "url"), type: attr(e, "type") });
      });
    }
    item.querySelectorAll("media\\:content").forEach(m => {
      enclosures.push({ url: attr(m, "url"), type: attr(m, "type") });
    });

    const media = pickBestEnclosure(enclosures);

    const psc = item.querySelector("psc\\:chapters");
    const pscChapters = psc
      ? [...psc.querySelectorAll("psc\\:chapter")].map(ch => ({
          t: parseTimeToSeconds(attr(ch, "start")),
          name: attr(ch, "title") || textFromXml(ch) || "Chapter",
        })).filter(c => Number.isFinite(c.t))
      : [];
    const podcastChapters = item.querySelector("podcast\\:chapters");
    const podcastChaptersUrl = podcastChapters ? attr(podcastChapters, "url") : "";
    const podcastChaptersType = podcastChapters ? (attr(podcastChapters, "type") || "application/json") : "";

    const transcripts = [];
    item.querySelectorAll("podcast\\:transcript").forEach(t => {
      const url = attr(t, "url");
      const type = (attr(t, "type") || "").toLowerCase();
      const rel = (attr(t, "rel") || "").toLowerCase();
      const lang = attr(t, "language") || "en";
      if (!url || !type) return;
      const isCaptions = rel === "captions";
      const isPlayable = type === "text/vtt" || type === "application/x-subrip";
      transcripts.push({ url, type, lang, isCaptions, isPlayable });
    });
    transcripts.sort((a, b) => {
      if (a.isPlayable !== b.isPlayable) return a.isPlayable ? -1 : 1;
      if (a.isCaptions !== b.isCaptions) return a.isCaptions ? -1 : 1;
      return 0;
    });

    idx += 1;
    const id = (guid || media?.url || link || `${title}#${idx}`).slice(0, 240);

    if (media?.pickedIsVideo) stats.videoPicked += 1;
    else if (media?.url) stats.audioPicked += 1;
    else stats.noMedia += 1;

    parsed.push({
      id,
      title,
      link,
      date,
      dateText: (date && !Number.isNaN(date.valueOf())) ? date.toISOString().slice(0, 10) : "",
      description: desc,
      channelTitle,
      durationSec: Number.isFinite(durationSec) ? durationSec : null,
      media: media?.url ? { url: media.url, type: media.type || "", hasVideoInFeed: media.hasVideoInFeed, pickedIsVideo: media.pickedIsVideo } : null,
      chaptersInline: pscChapters.length ? pscChapters : null,
      chaptersExternal: podcastChaptersUrl ? { url: podcastChaptersUrl, type: podcastChaptersType } : null,
      transcripts: transcripts.filter(t => t.isPlayable),
    });
  }

  return { channelTitle, episodes: parsed, stats };
}

const CATEGORY_ORDER = ["church", "university", "fitness", "bible", "twit", "podcastindex", "other", "needs-rss"];

function getNowEpisodeForSource(sourceId) {
  const cur = history.getCurrent();
  if (cur && cur.sourceId === sourceId) return cur.episodeId;
  for (const e of history.getEntries()) {
    if (e.sourceId === sourceId) return e.episodeId;
  }
  return null;
}

function getHistoryForEpisode(sourceId, episodeId) {
  const cur = history.getCurrent();
  if (cur && cur.sourceId === sourceId && cur.episodeId === episodeId) return cur;
  return history.getEntries().find(e => e.sourceId === sourceId && e.episodeId === episodeId);
}

function buildSourcesFlat() {
  const groups = new Map();
  for (const s of sources) {
    const cat = s.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  const cats = [...groups.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)) || a.localeCompare(b));
  sourcesFlat = [];
  for (const cat of cats) {
    const list = groups.get(cat).slice().sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
    sourcesFlat.push(...list);
  }
}

async function loadSourceEpisodes(sourceId) {
  if (episodesBySource[sourceId]) return episodesBySource[sourceId];
  const src = sources.find(s => s.id === sourceId);
  if (!src) return [];
  try {
    const xmlText = await fetchText(src.feed_url, src.fetch_via || "auto", { useCache: true });
    const parsed = parseFeed(xmlText, src);
    episodesBySource[sourceId] = parsed.episodes;
    return parsed.episodes;
  } catch {
    return [];
  }
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(sec)}s`;
}

function renderEpStrip(epStrip, src, eps) {
  epStrip.innerHTML = "";
  const srcNowEpId = getNowEpisodeForSource(src.id);
  const playable = eps.filter(e => e.media?.url && e.media?.pickedIsVideo);
  let nowBlock = null;
  for (let j = 0; j < playable.length; j++) {
    const ep = playable[j];
    const isNow = ep.id === srcNowEpId;
    const hist = getHistoryForEpisode(src.id, ep.id);
    const durSec = ep.durationSec ?? (hist ? Math.ceil((hist.end || 0) - (hist.start || 0)) : null);
    const durText = fmtDuration(durSec);
    const totalSec = ep.durationSec;
    const progressPct = (hist && totalSec && totalSec > 0) ? Math.min(100, 100 * (hist.end || 0) / totalSec) : null;

    const block = document.createElement("button");
    block.className = "guideEpBlock" + (isNow ? " now" : "") + (currentEp?.id === ep.id ? " active" : "");
    block.dataset.epIdx = String(j);
    block.dataset.epId = ep.id;
    block.dataset.sourceId = src.id;

    const titleEl = document.createElement("span");
    titleEl.className = "guideEpBlockTitle";
    titleEl.textContent = (ep.title || "Episode").slice(0, 24) + ((ep.title || "").length > 24 ? "…" : "");

    const meta = document.createElement("span");
    meta.className = "guideEpBlockMeta";
    if (isNow && hist) {
      const pos = fmtTime(hist.end || 0);
      const total = ep.durationSec ? " / " + fmtTime(ep.durationSec) : "";
      meta.textContent = `NOW · ${pos}${total}`;
    } else if (durText) {
      meta.textContent = durText;
    } else if (isNow) {
      meta.textContent = "NOW";
    }

    if (progressPct != null && progressPct > 0) {
      const prog = document.createElement("span");
      prog.className = "guideEpBlockProgress";
      prog.style.width = `${progressPct}%`;
      block.appendChild(prog);
    }
    block.append(titleEl, meta);
    epStrip.appendChild(block);
    if (isNow) nowBlock = block;
  }
  if (nowBlock) {
    requestAnimationFrame(() => nowBlock.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }));
  }
}

function updateGuideRow(row, src, eps) {
  const epStrip = row.querySelector(".guideEpStrip");
  if (!epStrip) return;
  renderEpStrip(epStrip, src, eps);
  row.dataset.loaded = "true";
  updateGuideFocus();
}

function setupGuideObserver() {
  if (guideObserver) guideObserver.disconnect();
  const container = guideFeeds;
  if (!container) return;
  guideObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const row = e.target;
        const sourceId = row.dataset.sourceId;
        if (!sourceId || row.dataset.loaded === "true" || guideLoadingSources.has(sourceId)) continue;
        const src = sources.find(s => s.id === sourceId);
        if (!src || episodesBySource[sourceId]) continue;
        guideLoadingSources.add(sourceId);
        loadSourceEpisodes(sourceId).then((eps) => {
          guideLoadingSources.delete(sourceId);
          if (guidePanel?.getAttribute("aria-hidden") === "false" && row.isConnected) {
            updateGuideRow(row, src, eps);
          }
        }).catch(() => guideLoadingSources.delete(sourceId));
      }
    },
    { root: container, rootMargin: "80px", threshold: 0.01 }
  );
}

function renderGuide() {
  guideFeeds.innerHTML = "";
  guideEpisodes.innerHTML = "";
  if (!sourcesFlat.length) return;

  for (let i = 0; i < sourcesFlat.length; i++) {
    const src = sourcesFlat[i];
    const isFocused = i === guideFocusSourceIdx;
    const eps = episodesBySource[src.id] ?? (currentSource?.id === src.id ? episodes : null);

    const row = document.createElement("div");
    row.className = "guideChannelRow" + (isFocused ? " focused" : "") + (currentSource?.id === src.id ? " playing" : "");
    row.dataset.sourceIdx = String(i);
    row.dataset.sourceId = src.id;

    const chName = document.createElement("div");
    chName.className = "guideChannelName";
    chName.textContent = src.title || src.id;

    const epStrip = document.createElement("div");
    epStrip.className = "guideEpStrip";

    if (eps) {
      renderEpStrip(epStrip, src, eps);
      row.dataset.loaded = "true";
    } else {
      const loadBtn = document.createElement("button");
      loadBtn.className = "guideEpBlock guideEpLoad";
      loadBtn.textContent = "…";
      loadBtn.addEventListener("click", async () => {
        const loaded = await loadSourceEpisodes(src.id);
        if (guidePanel?.getAttribute("aria-hidden") === "false") updateGuideRow(row, src, loaded);
      });
      epStrip.appendChild(loadBtn);
    }

    row.append(chName, epStrip);
    row.addEventListener("click", (e) => {
      if (e.target.closest(".guideEpBlock")) return;
      guideFocusSourceIdx = i;
      if (!episodesBySource[src.id]) loadSourceEpisodes(src.id).then((loaded) => updateGuideRow(row, src, loaded));
    });
    guideFeeds.appendChild(row);
  }

  const nowLabel = document.createElement("div");
  nowLabel.className = "guideNowLabel";
  nowLabel.textContent = currentSource ? (currentSource.title || currentSource.id) : "—";
  const nowEp = currentEp ? (currentEp.title || "Episode").slice(0, 50) + (currentEp.title?.length > 50 ? "…" : "") : "—";
  const nowEpEl = document.createElement("div");
  nowEpEl.className = "guideNowEp";
  nowEpEl.textContent = nowEp;
  guideEpisodes.append(nowLabel, nowEpEl);

  setupGuideObserver();
  [...guideFeeds.querySelectorAll(".guideChannelRow[data-loaded!='true']")].forEach((row) => guideObserver?.observe(row));
  updateGuideFocus();
}

function updateGuideFocus() {
  [...guideFeeds.querySelectorAll(".guideChannelRow")].forEach((row, i) => {
    row.classList.toggle("focused", i === guideFocusSourceIdx);
  });
  const row = guideFeeds.querySelector(".guideChannelRow.focused");
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const blocks = row?.querySelectorAll(".guideEpBlock:not(.guideEpLoad)") || [];
  blocks.forEach((b, j) => b.classList.toggle("focused", j === guideFocusEpIdx));
}

function handleGuideKey(e) {
  if (guidePanel.getAttribute("aria-hidden") !== "false") return false;
  const k = e.key;
  if (k === "ArrowUp") {
    e.preventDefault();
    guideFocusSourceIdx = Math.max(0, guideFocusSourceIdx - 1);
    guideFocusEpIdx = 0;
    const src = sourcesFlat[guideFocusSourceIdx];
    if (src && !episodesBySource[src.id]) {
      const row = guideFeeds?.querySelector(`[data-source-id="${src.id}"]`);
      loadSourceEpisodes(src.id).then((eps) => row?.isConnected && updateGuideRow(row, src, eps));
    } else {
      updateGuideFocus();
    }
    return true;
  }
  if (k === "ArrowDown") {
    e.preventDefault();
    guideFocusSourceIdx = Math.min(sourcesFlat.length - 1, guideFocusSourceIdx + 1);
    guideFocusEpIdx = 0;
    const src = sourcesFlat[guideFocusSourceIdx];
    if (src && !episodesBySource[src.id]) {
      const row = guideFeeds?.querySelector(`[data-source-id="${src.id}"]`);
      loadSourceEpisodes(src.id).then((eps) => row?.isConnected && updateGuideRow(row, src, eps));
    } else {
      updateGuideFocus();
    }
    return true;
  }
  if (k === "ArrowLeft") {
    e.preventDefault();
    guideFocusEpIdx = Math.max(0, guideFocusEpIdx - 1);
    updateGuideFocus();
    return true;
  }
  if (k === "ArrowRight") {
    e.preventDefault();
    const eps = episodesBySource[sourcesFlat[guideFocusSourceIdx]?.id] || [];
    const playable = eps.filter(ep => ep.media?.url && ep.media?.pickedIsVideo);
    guideFocusEpIdx = Math.min(Math.max(0, playable.length - 1), guideFocusEpIdx + 1);
    updateGuideFocus();
    return true;
  }
  if (k === "Enter") {
    e.preventDefault();
    const src = sourcesFlat[guideFocusSourceIdx];
    const eps = episodesBySource[src?.id] || (currentSource?.id === src?.id ? episodes : []);
    const playable = eps.filter(ep => ep.media?.url && ep.media?.pickedIsVideo);
    const ep = playable[guideFocusEpIdx];
    if (ep) {
      loadSource(src.id, { preserveEpisode: false }).then(() => loadEpisode(ep.id, { autoplay: !userPaused }));
      closeGuide();
    }
    return true;
  }
  const num = parseInt(k, 10);
  if (k >= "0" && k <= "9" && sourcesFlat.length > 0) {
    e.preventDefault();
    const idx = num === 0 ? 9 : num - 1;
    if (idx < sourcesFlat.length) {
      guideFocusSourceIdx = idx;
      guideFocusEpIdx = 0;
      const src = sourcesFlat[idx];
      if (src && !episodesBySource[src.id]) {
        const row = guideFeeds?.querySelector(`[data-source-id="${src.id}"]`);
        loadSourceEpisodes(src.id).then((eps) => row?.isConnected && updateGuideRow(row, src, eps));
      } else {
        updateGuideFocus();
      }
    }
    return true;
  }
  return false;
}

function openGuide() {
  guidePanel.setAttribute("aria-hidden", "false");
  guideFocusSourceIdx = sourcesFlat.findIndex(s => s.id === currentSource?.id);
  if (guideFocusSourceIdx < 0) guideFocusSourceIdx = 0;
  guideFocusEpIdx = 0;
  const cur = getNowEpisodeForSource(currentSource?.id);
  if (cur && episodes.length) {
    const playable = episodes.filter(e => e.media?.url && e.media?.pickedIsVideo);
    const idx = playable.findIndex(e => e.id === cur);
    if (idx >= 0) guideFocusEpIdx = idx;
  }
  renderGuide();
  recordInteraction();
}

function closeGuide() {
  guidePanel.setAttribute("aria-hidden", "true");
  guideObserver?.disconnect();
  guideObserver = null;
}

let historyPanelInstance = null;

function openHistory() {
  historyPanel.setAttribute("aria-hidden", "false");
  historyCloseTo = Date.now() + HISTORY_CLOSE_MS;
  if (!historyPanelInstance) {
    historyPanelInstance = history.render(historyPanelContent, {
      onEntryClick: async (entry) => {
        closeHistory();
        await loadSource(entry.sourceId, { preserveEpisode: false, skipAutoEpisode: true });
        const ep = episodes.find(e => e.id === entry.episodeId) ?? episodesBySource[entry.sourceId]?.find(e => e.id === entry.episodeId);
        if (ep) {
          await loadEpisode(entry.episodeId, { autoplay: true, startAt: entry.end });
        }
      },
      onRestart: async (entry) => {
        closeHistory();
        await loadSource(entry.sourceId, { preserveEpisode: false, skipAutoEpisode: true });
        const ep = episodes.find(e => e.id === entry.episodeId) ?? episodesBySource[entry.sourceId]?.find(e => e.id === entry.episodeId);
        if (ep) {
          await loadEpisode(entry.episodeId, { autoplay: true, startAt: entry.start });
        }
      },
      onContinue: async (entry) => {
        closeHistory();
        const seekTo = Math.max(0, (entry.end || 0) - 5);
        await loadSource(entry.sourceId, { preserveEpisode: false, skipAutoEpisode: true });
        const ep = episodes.find(e => e.id === entry.episodeId) ?? episodesBySource[entry.sourceId]?.find(e => e.id === entry.episodeId);
        if (ep) {
          await loadEpisode(entry.episodeId, { autoplay: true, startAt: seekTo });
        }
      },
      fmtTime,
    });
    if (historyPanelInstance?.closeBtn) {
      historyPanelInstance.closeBtn.addEventListener("click", closeHistory);
    }
  }
}

function closeHistory() {
  historyPanel.setAttribute("aria-hidden", "true");
}

function openDetails() {
  detailsPanel.setAttribute("aria-hidden", "false");
}

function closeDetails() {
  detailsPanel.setAttribute("aria-hidden", "true");
}

function updateGuideBar() {
  btnChannel.textContent = currentSource?.title || currentSource?.id || "—";
  guideNow.textContent = currentEp?.title ? (currentEp.title.slice(0, 40) + (currentEp.title.length > 40 ? "…" : "")) : "—";
  btnPlay.textContent = video.paused ? "▶" : "⏸";
  const hasTracks = video.textTracks?.length > 0;
  if (btnCC) {
    btnCC.style.display = hasTracks ? "" : "none";
    const showing = [...(video.textTracks || [])].some(t => t.mode === "showing");
    btnCC.classList.toggle("active", showing);
  }
}

function switchFeed(delta) {
  if (!sourcesFlat.length) return;
  const idx = sourcesFlat.findIndex(s => s.id === currentSource?.id);
  const nextIdx = idx < 0 ? 0 : clamp(idx + delta, 0, sourcesFlat.length - 1);
  const next = sourcesFlat[nextIdx];
  if (next) loadSource(next.id, { preserveEpisode: false });
}

async function doRandom() {
  if (!sourcesFlat.length) return;
  let attempts = 0;
  const tryOne = async () => {
    const src = sourcesFlat[Math.floor(Math.random() * sourcesFlat.length)];
    await loadSource(src.id, { preserveEpisode: false, pickRandomEpisode: true });
    const playable = episodes.filter(e => e.media?.url && e.media?.pickedIsVideo);
    if (!playable.length && ++attempts < 3) await tryOne();
  };
  await tryOne();
}

async function loadSource(sourceId, { preserveEpisode = true, pickRandomEpisode = false, skipAutoEpisode = false } = {}) {
  const src = sources.find(s => s.id === sourceId) || sources[0];
  if (!src) return;

  currentSource = src;
  guideEpisodes.innerHTML = "";

  try {
    log(`Fetching feed: ${src.title || src.id}`);
    const xmlText = await fetchText(src.feed_url, src.fetch_via || "auto", { useCache: true });
    const parsed = parseFeed(xmlText, src);
    episodes = parsed.episodes;
    episodesBySource[src.id] = episodes;
    const playable = episodes.filter(e => e.media?.url && e.media?.pickedIsVideo);
    const playableAny = episodes.filter(e => e.media?.url);
    const st = parsed.stats;
    log(`${parsed.channelTitle}: ${st.itemCount} items, ${playable.length} video. Video: ${st.videoPicked}, audio: ${st.audioPicked}`);
    if (st.audioPicked > 0 && st.videoPicked === 0) {
      log("Feed has no video enclosures", "warn");
    }

    let wanted;
    if (!skipAutoEpisode) {
      if (pickRandomEpisode && playable.length) {
        wanted = playable[Math.floor(Math.random() * playable.length)].id;
      } else {
        const lastId = state.lastBySource?.[src.id] || (preserveEpisode && state.last?.sourceId === src.id ? state.last?.episodeId : null);
        const lastIsVideo = lastId && playable.some(e => e.id === lastId);
        wanted = (lastIsVideo ? lastId : null) || playable[0]?.id || playableAny[0]?.id || null;
      }
    }
    if (wanted) {
      await loadEpisode(wanted, { autoplay: !userPaused });
    }
    if (guidePanel?.getAttribute("aria-hidden") === "false") renderGuide();
    updateGuideBar();
  } catch (e) {
    episodes = [];
    log(`Feed error: ${String(e?.message || e)} — ${src.feed_url}`, "error");
    updateGuideBar();
  }
}

async function loadEpisode(episodeId, { autoplay = true, startAt: overrideStartAt } = {}) {
  const ep = episodes.find(e => e.id === episodeId) || episodes.find(e => e.media?.url);
  if (!ep) return;

  if (!ep.media?.url) {
    log(`Episode "${ep.title.slice(0, 40)}…": no media URL`, "warn");
    return;
  }

  if (!ep.media.pickedIsVideo) {
    log("Skipping audio-only episode", "info");
    return;
  }

  teardownPlayer();
  currentEp = ep;

  const startAt = overrideStartAt ?? getProgressSec(currentSource.id, ep.id) ?? 0;
  history.startSegment({
    sourceId: currentSource.id,
    episodeId: ep.id,
    episodeTitle: ep.title,
    channelTitle: ep.channelTitle || currentSource.title,
    startTime: startAt,
  });
  state.last = { sourceId: currentSource.id, episodeId: ep.id, at: Date.now() };
  state.lastBySource ||= {};
  state.lastBySource[currentSource.id] = ep.id;
  saveState();

  epTitle.textContent = ep.title;
  epSub.textContent = `${ep.channelTitle || currentSource.title}${ep.dateText ? " · " + ep.dateText : ""}`;
  epDesc.innerHTML = ep.description ? sanitizeHtml(ep.description) : "";
  chaptersEl.innerHTML = "";

  const mediaUrl = ep.media.url;
  const mediaType = ep.media.type || "";
  const shouldUseHls = isProbablyHls(mediaUrl, mediaType);
  const usingNative = shouldUseHls && isNativeHls();
  const usingHlsJs = shouldUseHls && !usingNative && window.Hls && Hls.isSupported();

  if (shouldUseHls && !usingNative && !usingHlsJs) {
    log("HLS not supported", "error");
    return;
  }

  if (usingNative) {
    video.src = mediaUrl;
  } else if (usingHlsJs) {
    hls = new Hls({ enableWorker: true });
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data?.fatal) log(`HLS error: ${data?.type || "fatal"}`, "error");
    });
    hls.loadSource(mediaUrl);
    hls.attachMedia(video);
  } else {
    video.src = mediaUrl;
  }

  video.addEventListener("loadedmetadata", () => {
    const dur = video.duration;
    if (Number.isFinite(dur) && dur > 2) {
      const safe = (startAt > dur - 20) ? 0 : clamp(startAt, 0, Math.max(0, dur - 0.25));
      if (safe > 0.25) video.currentTime = safe;
    }
    updateGuideBar();
    if (autoplay) {
      userPaused = false;
      video.muted = false;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    }
  }, { once: true });

  await loadTranscripts(ep);
  await loadAndRenderChapters(ep);
  updateGuideBar();
}

function srtToWebVTT(srt) {
  return "WEBVTT\n\n" + srt
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
}

async function loadTranscripts(ep) {
  const list = ep.transcripts || [];
  if (!list.length) return;
  for (const t of list) {
    try {
      const isRemote = /^https?:\/\//i.test(t.url);
      const finalUrl = isRemote ? (FEED_PROXY + encodeURIComponent(t.url)) : t.url;
      let txt = await fetch(finalUrl, { cache: "no-store" }).then(r => r.ok ? r.text() : Promise.reject(new Error(r.status)));
      if (t.type === "application/x-subrip") {
        txt = srtToWebVTT(txt);
      }
      const blob = new Blob([txt], { type: "text/vtt" });
      const blobUrl = URL.createObjectURL(blob);
      transcriptBlobUrls.push(blobUrl);
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.src = blobUrl;
      track.srclang = t.lang;
      track.label = t.lang === "en" ? "English" : t.lang;
      track.default = transcriptBlobUrls.length === 1;
      video.appendChild(track);
      log(`Subtitles: loaded ${t.lang} (${t.type})`);
    } catch (e) {
      log(`Subtitles failed: ${t.url}`, "warn");
    }
  }
}

async function loadAndRenderChapters(ep) {
  const inline = ep.chaptersInline;
  if (inline?.length) {
    renderChapters(inline);
    return;
  }
  const ext = ep.chaptersExternal;
  if (!ext?.url) return;
  try {
    const txt = await fetchText(ext.url, currentSource.fetch_via || "auto");
    const data = JSON.parse(txt);
    const chs = Array.isArray(data?.chapters) ? data.chapters : [];
    const parsed = chs
      .map((c) => {
        const t = parseTimeToSeconds(c.startTime ?? c.start ?? c.t ?? c.time);
        const name = String(c.title ?? c.name ?? c.text ?? "Chapter");
        return { t, name };
      })
      .filter(c => Number.isFinite(c.t))
      .sort((a, b) => a.t - b.t);
    renderChapters(parsed);
  } catch {}
}

function renderChapters(chapters) {
  chaptersEl.innerHTML = "";
  chapters.forEach((c, idx) => {
    const el = document.createElement("div");
    el.className = "ch";
    el.dataset.idx = String(idx);
    el.dataset.t = String(c.t);
    const name = document.createElement("div");
    name.className = "chName";
    name.textContent = c.name || "Chapter";
    const time = document.createElement("div");
    time.className = "chTime";
    time.textContent = fmtTime(c.t);
    el.append(name, time);
    el.addEventListener("click", () => {
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      video.currentTime = clamp(c.t, 0, Math.max(0, video.duration - 0.25));
      video.play().catch(() => {});
    });
    chaptersEl.appendChild(el);
  });
}

function activeChapterIdx() {
  const ch = [...chaptersEl.querySelectorAll(".ch")];
  if (!ch.length) return -1;
  const t = video.currentTime || 0;
  let idx = -1;
  for (let i = 0; i < ch.length; i++) {
    const ct = Number(ch[i].dataset.t);
    if (Number.isFinite(ct) && ct <= t + 0.01) idx = i;
  }
  return idx;
}

function syncActiveChapter() {
  const idx = activeChapterIdx();
  [...chaptersEl.querySelectorAll(".ch")].forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.idx) === idx);
  });
}

function updateSleepCountdown() {
  if (!sleepEndAt || !btnSleep) return;
  const left = Math.max(0, Math.ceil((sleepEndAt - Date.now()) / 1000));
  if (left <= 0) {
    sleepEndAt = null;
    if (sleepTickId) clearInterval(sleepTickId);
    sleepTickId = null;
    btnSleep.textContent = "Sleep";
    userPaused = true;
    video.pause();
    history.markCurrentHadSleep();
    return;
  }
  const m = Math.floor(left / 60);
  const s = left % 60;
  btnSleep.textContent = `${m}:${String(s).padStart(2, "0")}`;
}

function updateHud() {
  const ct = video.currentTime || 0;
  const dur = video.duration;
  const live = !Number.isFinite(dur) || dur === Infinity;
  guideTime.textContent = live ? fmtTime(ct) : `${fmtTime(ct)} / ${fmtTime(dur || 0)}`;

  if (!live && Number.isFinite(dur) && dur > 0.2) {
    const pct = clamp(ct / dur, 0, 1) * 100;
    progressFill.style.width = `${pct}%`;
    if (guideSeekFill) guideSeekFill.style.width = `${pct}%`;
  } else {
    progressFill.style.width = "0%";
    if (guideSeekFill) guideSeekFill.style.width = "0%";
  }
}

function tick() {
  if (!currentSource || !currentEp) return;
  updateGuideBar();
  updateHud();
  syncActiveChapter();

  const dur = video.duration;
  const live = !Number.isFinite(dur) || dur === Infinity;
  if (live) return;

  const ct = video.currentTime || 0;
  history.updateEnd(ct);

  const now = performance.now();
  if (now - lastPersistMs < 1000) return;
  lastPersistMs = now;

  if (Number.isFinite(dur) && dur > 10 && ct > 0.5 && ct < dur - 1.5) {
    setProgressSec(currentSource.id, currentEp.id, ct);
  }
}

function wireUI() {
  document.addEventListener("click", () => recordInteraction(), { capture: true });
  document.addEventListener("keydown", () => recordInteraction(), { capture: true });
  const app = $("#app");
  let lastMove = 0;
  app?.addEventListener("mousemove", () => { if (Date.now() - lastMove > 200) { lastMove = Date.now(); resetGuideBarIdle(); } });
  app?.addEventListener("touchstart", () => resetGuideBarIdle(), { passive: true });

  btnChannel.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    if (guidePanel.getAttribute("aria-hidden") === "true") openGuide();
    else closeGuide();
  });

  guideFeeds?.addEventListener("click", (e) => {
    const block = e.target.closest(".guideEpBlock:not(.guideEpLoad)");
    if (!block) return;
    e.stopPropagation();
    e.preventDefault();
    const srcId = block.dataset.sourceId;
    const epIdx = parseInt(block.dataset.epIdx, 10);
    if (!srcId || !Number.isFinite(epIdx)) return;
    const eps = episodesBySource[srcId] ?? (currentSource?.id === srcId ? episodes : null);
    const playable = eps ? eps.filter(ep => ep.media?.url && ep.media?.pickedIsVideo) : [];
    const ep = playable[epIdx];
    if (!ep) return;
    if (currentSource?.id === srcId) {
      loadEpisode(ep.id, { autoplay: !userPaused });
    } else {
      loadSource(srcId, { preserveEpisode: false, skipAutoEpisode: true }).then(() => loadEpisode(ep.id, { autoplay: !userPaused }));
    }
    if (guidePanel?.getAttribute("aria-hidden") === "false") renderGuide();
  });

  btnCloseGuide.addEventListener("click", closeGuide);

  btnRandom.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    doRandom();
  });

  if (btnCC) {
    btnCC.addEventListener("click", (e) => {
      e.stopPropagation();
      recordInteraction();
      const tracks = [...(video.textTracks || [])];
      if (!tracks.length) return;
      const showing = tracks.find(t => t.mode === "showing");
      if (showing) {
        showing.mode = "disabled";
      } else {
        tracks[0].mode = "showing";
      }
      updateGuideBar();
    });
  }

  btnPlay.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    if (video.paused) {
      userPaused = false;
      video.play().catch(() => {});
    } else {
      userPaused = true;
      video.pause();
    }
  });

  video.addEventListener("click", () => btnPlay.click());
  video.addEventListener("play", updateGuideBar);
  video.addEventListener("pause", updateGuideBar);

  progress.addEventListener("click", (e) => {
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur === Infinity || dur <= 0.2) return;
    const r = progress.getBoundingClientRect();
    const pct = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    video.currentTime = clamp(pct * dur, 0, Math.max(0, dur - 0.25));
  });

  if (btnSeekBack) btnSeekBack.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur === Infinity) return;
    video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
  });
  if (btnSeekFwd) btnSeekFwd.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur === Infinity) return;
    video.currentTime = Math.min(dur - 0.25, (video.currentTime || 0) + 30);
  });
  if (guideSeek) guideSeek.addEventListener("click", (e) => {
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur === Infinity || dur <= 0.2) return;
    const r = guideSeek.getBoundingClientRect();
    const pct = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    video.currentTime = clamp(pct * dur, 0, Math.max(0, dur - 0.25));
  });

  if (btnSleep) btnSleep.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    if (sleepEndAt) {
      sleepEndAt = null;
      if (sleepTickId) clearInterval(sleepTickId);
      sleepTickId = null;
      btnSleep.textContent = "Sleep";
      return;
    }
    const hidden = sleepMenu.getAttribute("aria-hidden") !== "false";
    sleepMenu.setAttribute("aria-hidden", hidden ? "false" : "true");
  });
  document.addEventListener("click", (e) => {
    if (sleepMenu && !sleepMenu.contains(e.target) && !btnSleep?.contains(e.target)) {
      sleepMenu.setAttribute("aria-hidden", "true");
    }
  });
  [...(sleepMenu?.querySelectorAll(".sleepOpt") || [])].forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mins = Number(btn.dataset.mins) || 15;
      sleepEndAt = Date.now() + mins * 60 * 1000;
      sleepMenu.setAttribute("aria-hidden", "true");
      if (sleepTickId) clearInterval(sleepTickId);
      sleepTickId = setInterval(updateSleepCountdown, 1000);
      updateSleepCountdown();
    });
  });

  if (btnHistory) btnHistory.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    if (historyPanel.getAttribute("aria-hidden") === "true") openHistory();
    else closeHistory();
  });

  if (btnDetails) btnDetails.addEventListener("click", () => {
    if (detailsPanel.getAttribute("aria-hidden") === "true") openDetails();
    else closeDetails();
  });
  if (btnCloseDetails) btnCloseDetails.addEventListener("click", closeDetails);

  if (btnClearLog) {
    btnClearLog.addEventListener("click", () => {
      logEntries.length = 0;
      if (logOutput) logOutput.innerHTML = "";
    });
  }

  if (btnTheme) btnTheme.addEventListener("click", (e) => {
    e.stopPropagation();
    recordInteraction();
    const cur = htmlRoot?.getAttribute("data-theme") || "modern";
    const idx = THEMES.indexOf(cur);
    const next = THEMES[(idx + 1) % THEMES.length];
    htmlRoot?.setAttribute("data-theme", next);
    try { localStorage.setItem(STORAGE_KEY + "_theme", next); } catch {}
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
    if (handleGuideKey(e)) return;
    const k = e.key.toLowerCase();
    if (k === " ") {
      e.preventDefault();
      recordInteraction();
      btnPlay.click();
    }
    if (k === "arrowleft") {
      e.preventDefault();
      if (e.shiftKey) {
        if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
        video.currentTime = Math.max(0, (video.currentTime || 0) - 20);
      } else if (guidePanel.getAttribute("aria-hidden") !== "false") {
        switchFeed(-1);
      }
    }
    if (k === "arrowright") {
      e.preventDefault();
      if (e.shiftKey) {
        if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
        const dur = video.duration || 0;
        video.currentTime = Math.min(dur - 0.25, (video.currentTime || 0) + 20);
      } else if (guidePanel.getAttribute("aria-hidden") !== "false") {
        switchFeed(1);
      }
    }
    if (k === "f") {
      e.preventDefault();
      try {
        const wrap = $("#player");
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap?.requestFullscreen?.();
      } catch {}
    }
    if (k === "m") {
      e.preventDefault();
      video.muted = !video.muted;
    }
    if (k === "escape") {
      closeGuide();
      closeDetails();
      closeHistory();
    }
  });
}

async function boot() {
  wireUI();

  const savedTheme = localStorage.getItem(STORAGE_KEY + "_theme");
  if (savedTheme && THEMES.includes(savedTheme)) {
    htmlRoot?.setAttribute("data-theme", savedTheme);
  }

  guideBarIdleTo = Date.now() + GUIDE_IDLE_MS;
  setInterval(() => {
    const now = Date.now();
    if (guideBar && guideBarIdleTo != null && now > guideBarIdleTo) {
      guideBar.classList.add("idle");
    }
    if (historyPanel?.getAttribute("aria-hidden") === "false" && historyCloseTo != null && now > historyCloseTo) {
      closeHistory();
      historyCloseTo = null;
    }
  }, 500);

  try {
    log("Loading sources…");
    const txt = await fetchText(SOURCES_URL, "direct");
    const data = JSON.parse(txt);
    sources = (data?.sources || []).filter(s => s && typeof s === "object").map(s => ({
      id: String(s.id || "").trim(),
      title: String(s.title || "").trim(),
      category: String(s.category || "other").trim() || "other",
      feed_url: String(s.feed_url || s.feed || "").trim(),
      fetch_via: s.fetch_via || "auto",
    })).filter(s => s.id && s.feed_url);
  } catch (e) {
    sources = [];
    log(`Sources error: ${String(e?.message || e)}`, "error");
    return;
  }

  log(`Loaded ${sources.length} sources`);
  if (!sources.length) return;

  buildSourcesFlat();
  const lastSource = sources.find(s => s.id === state.last?.sourceId)?.id;
  const initial = lastSource || sources[0].id;
  await loadSource(initial, { preserveEpisode: true });
  updateGuideBar();

  setInterval(tick, 250);

  window.addEventListener("beforeunload", () => {
    if (video?.currentTime != null) history.updateEnd(video.currentTime);
    history.finalize();
  });
}

boot();
