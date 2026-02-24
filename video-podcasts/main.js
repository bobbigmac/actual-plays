const $ = (s, el = document) => el.querySelector(s);

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
const feedSelect = $("#feedSelect");
const episodesEl = $("#episodes");
const sideMsg = $("#sideMsg");
const btnPlay = $("#btnPlay");
const hudTitle = $("#hudTitle");
const hudTime = $("#hudTime");
const progress = $("#progress");
const progressFill = $("#progressFill");
const epTitle = $("#epTitle");
const epSub = $("#epSub");
const epDesc = $("#epDesc");
const chaptersEl = $("#chapters");
const chaptersMeta = $("#chaptersMeta");
const logOutput = $("#logOutput");
const btnClearLog = $("#btnClearLog");

let sources = [];
let currentSource = null;
let episodes = [];
let currentEp = null;
let hls = null;
let lastPersistMs = 0;

const state = loadState();

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

function setMsg(text) {
  sideMsg.textContent = text || "";
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

function teardownPlayer() {
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

async function fetchText(url, fetchVia = "auto") {
  const u = String(url || "");
  const isRemote = /^https?:\/\//i.test(u);
  const via = fetchVia === "auto" ? (isRemote ? "proxy" : "direct") : fetchVia;
  const finalUrl = (via === "proxy" && isRemote) ? (FEED_PROXY + encodeURIComponent(u)) : u;
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
  const stats = {
    itemCount: items.length,
    enclosureCount: 0,
    atomEnclosureCount: 0,
    mediaContentCount: 0,
    pscItems: 0,
    podcastChaptersItems: 0,
    mediaTypes: {},
    videoPicked: 0,
    audioPicked: 0,
    noMedia: 0,
  };
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

    const enclosures = [];
    if (isAtom) {
      item.querySelectorAll("link[rel='enclosure']").forEach(l => {
        enclosures.push({ url: attr(l, "href"), type: attr(l, "type") });
      });
      stats.atomEnclosureCount += item.querySelectorAll("link[rel='enclosure']").length;
    } else {
      item.querySelectorAll("enclosure").forEach(e => {
        enclosures.push({ url: attr(e, "url"), type: attr(e, "type") });
      });
      stats.enclosureCount += item.querySelectorAll("enclosure").length;
    }
    item.querySelectorAll("media\\:content").forEach(m => {
      enclosures.push({ url: attr(m, "url"), type: attr(m, "type") });
    });
    stats.mediaContentCount += item.querySelectorAll("media\\:content").length;

    const media = pickBestEnclosure(enclosures);

    const psc = item.querySelector("psc\\:chapters");
    if (psc) stats.pscItems += 1;
    const pscChapters = psc
      ? [...psc.querySelectorAll("psc\\:chapter")].map(ch => ({
          t: parseTimeToSeconds(attr(ch, "start")),
          name: attr(ch, "title") || textFromXml(ch) || "Chapter",
        })).filter(c => Number.isFinite(c.t))
      : [];

    const podcastChapters = item.querySelector("podcast\\:chapters");
    if (podcastChapters) stats.podcastChaptersItems += 1;
    const podcastChaptersUrl = podcastChapters ? attr(podcastChapters, "url") : "";
    const podcastChaptersType = podcastChapters ? (attr(podcastChapters, "type") || "application/json") : "";

    idx += 1;
    const id = (guid || media?.url || link || `${title}#${idx}`).slice(0, 240);

    if (media?.type) stats.mediaTypes[media.type] = (stats.mediaTypes[media.type] || 0) + 1;
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
      media: media?.url ? { url: media.url, type: media.type || "", hasVideoInFeed: media.hasVideoInFeed, pickedIsVideo: media.pickedIsVideo } : null,
      chaptersInline: pscChapters.length ? pscChapters : null,
      chaptersExternal: podcastChaptersUrl ? { url: podcastChaptersUrl, type: podcastChaptersType } : null,
    });
  }

  return { channelTitle, episodes: parsed, stats };
}

function renderSources() {
  feedSelect.innerHTML = "";
  const groups = new Map();
  for (const s of sources) {
    const cat = s.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  const order = ["church", "university", "fitness", "bible", "other", "needs-rss"];
  const cats = [...groups.keys()].sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || a.localeCompare(b));
  for (const cat of cats) {
    const og = document.createElement("optgroup");
    og.label = cat;
    const list = groups.get(cat).slice().sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
    for (const s of list) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.title || s.id;
      og.appendChild(opt);
    }
    feedSelect.appendChild(og);
  }
}

function renderEpisodes() {
  episodesEl.innerHTML = "";
  for (const ep of episodes) {
    const el = document.createElement("div");
    el.className = "ep";
    el.dataset.id = ep.id;
    el.classList.toggle("disabled", !ep.media?.url);

    const t = document.createElement("p");
    t.className = "epTitle";
    t.textContent = ep.title;

    const sub = document.createElement("div");
    sub.className = "epSub";

    const left = document.createElement("div");
    left.textContent = ep.dateText || "";

    const p = getProgressSec(currentSource.id, ep.id);
    const right = document.createElement("div");
    right.className = "mono";
    right.textContent = ep.media?.url ? (p > 1 ? fmtTime(p) : "") : "no media";

    sub.append(left, right);
    el.append(t, sub);

    el.addEventListener("click", () => loadEpisode(ep.id, { autoplay: true }));
    episodesEl.appendChild(el);
  }
  syncActiveEpisode();
}

function syncActiveEpisode() {
  [...episodesEl.querySelectorAll(".ep")].forEach(el => {
    el.classList.toggle("active", !!currentEp && el.dataset.id === currentEp.id);
  });
}

async function loadSource(sourceId, { preserveEpisode = true } = {}) {
  const src = sources.find(s => s.id === sourceId) || sources[0];
  if (!src) return;

  currentSource = src;
  setMsg("Loading feed…");
  episodesEl.innerHTML = "";
  chaptersEl.innerHTML = "";
  chaptersMeta.textContent = "—";

  try {
    log(`Fetching feed: ${src.title || src.id}`);
    dbg("loadSource", { id: src.id, title: src.title, category: src.category, feed_url: src.feed_url, fetch_via: src.fetch_via });
    const xmlText = await fetchText(src.feed_url, src.fetch_via || "auto");
    const parsed = parseFeed(xmlText, src);
    episodes = parsed.episodes;
    const playable = episodes.filter(e => e.media?.url).length;
    const st = parsed.stats;
    const feedSummary = `${parsed.channelTitle}: ${st.itemCount} items, ${playable} playable. Video: ${st.videoPicked}, audio: ${st.audioPicked}, no media: ${st.noMedia}`;
    log(feedSummary);
    if (st.audioPicked > 0 && st.videoPicked === 0) {
      log("Feed has no video enclosures — episodes will play audio only", "warn");
    }
    setMsg(`${parsed.channelTitle} · ${playable}/${episodes.length} playable`);
    renderEpisodes();
    dbg("feedParsed", { id: src.id, channelTitle: parsed.channelTitle, playable, total: episodes.length, stats: parsed.stats });

    const wanted =
      state.lastBySource?.[src.id] ||
      (preserveEpisode && state.last?.sourceId === src.id ? state.last?.episodeId : null) ||
      episodes[0]?.id ||
      null;
    if (wanted) await loadEpisode(wanted, { autoplay: false });
  } catch (e) {
    episodes = [];
    const errMsg = String(e?.message || e);
    log(`Feed error: ${errMsg} — ${src.feed_url}`, "error");
    setMsg(`Couldn't load feed: ${errMsg}`);
    dbg("loadSourceError", { id: src.id, err: errMsg });
  }
}

async function loadEpisode(episodeId, { autoplay = false } = {}) {
  const ep = episodes.find(e => e.id === episodeId) || episodes[0];
  if (!ep) return;

  teardownPlayer();
  currentEp = ep;
  state.last = { sourceId: currentSource.id, episodeId: ep.id, at: Date.now() };
  state.lastBySource ||= {};
  state.lastBySource[currentSource.id] = ep.id;
  saveState();
  syncActiveEpisode();

  hudTitle.textContent = ep.title;
  epTitle.textContent = ep.title;
  epSub.textContent = `${ep.channelTitle || currentSource.title || currentSource.id}${ep.dateText ? " · " + ep.dateText : ""}`;

  const cleanDesc = ep.description ? sanitizeHtml(ep.description) : "";
  epDesc.innerHTML = cleanDesc || "";

  chaptersEl.innerHTML = "";
  chaptersMeta.textContent = "—";

  if (!ep.media?.url) {
    log(`Episode "${ep.title.slice(0, 40)}…": no media URL`, "warn");
    setMsg("No media URL found for this episode.");
    dbg("loadEpisode:noMedia", { sourceId: currentSource.id, episodeId: ep.id, title: ep.title });
    await loadAndRenderChapters(ep);
    updateButtons();
    return;
  }

  const mediaUrl = ep.media.url;
  const mediaType = ep.media.type || "";

  const shouldUseHls = isProbablyHls(mediaUrl, mediaType);
  const usingNative = shouldUseHls && isNativeHls();
  const usingHlsJs = shouldUseHls && !usingNative && window.Hls && Hls.isSupported();

  const startAt = getProgressSec(currentSource.id, ep.id) || 0;
  const mediaKind = ep.media.pickedIsVideo ? "video" : "audio";
  log(`Episode: ${ep.title.slice(0, 35)}… | type: ${mediaType || "(none)"} | ${mediaKind}`);
  if (ep.media.hasVideoInFeed && !ep.media.pickedIsVideo) {
    log("Feed had video enclosures but picked audio — possible enclosure order issue", "warn");
  } else if (!ep.media.pickedIsVideo) {
    log("Audio-only enclosure in this episode", "info");
  }
  dbg("loadEpisode", {
    sourceId: currentSource.id,
    episodeId: ep.id,
    title: ep.title,
    mediaUrl,
    mediaType,
    shouldUseHls,
    usingNative,
    usingHlsJs,
    startAt,
    chaptersInline: ep.chaptersInline?.length || 0,
    chaptersExternal: ep.chaptersExternal?.url || null,
  });

  if (shouldUseHls && !usingNative && !usingHlsJs) {
    log("HLS not supported in this browser", "error");
    setMsg("This episode is HLS, but HLS isn't supported here.");
    return;
  }

  if (usingNative) {
    video.src = mediaUrl;
  } else if (usingHlsJs) {
    hls = new Hls({ enableWorker: true });
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data?.fatal) {
        const msg = `HLS error: ${data?.type || "fatal"}${data?.details ? " — " + data.details : ""}`;
        log(msg, "error");
        setMsg(msg);
      }
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
    updateHud();
    if (autoplay) video.play().catch(() => {});
  }, { once: true });

  await loadAndRenderChapters(ep);
  updateButtons();
}

async function loadAndRenderChapters(ep) {
  const inline = ep.chaptersInline;
  if (inline?.length) {
    renderChapters(inline);
    chaptersMeta.textContent = `${inline.length}`;
    dbg("chapters:inline", { sourceId: currentSource?.id, episodeId: ep.id, count: inline.length });
    return;
  }

  const ext = ep.chaptersExternal;
  if (!ext?.url) {
    chaptersEl.innerHTML = "";
    chaptersMeta.textContent = "—";
    dbg("chapters:none", { sourceId: currentSource?.id, episodeId: ep.id });
    return;
  }

  chaptersMeta.textContent = "loading…";
  try {
    log(`Chapters: fetching ${ext.url.slice(0, 50)}…`);
    dbg("chapters:external:fetch", { sourceId: currentSource?.id, episodeId: ep.id, url: ext.url, type: ext.type });
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
    chaptersMeta.textContent = `${parsed.length}`;
    log(`Chapters: loaded ${parsed.length} from external`);
    dbg("chapters:external:ok", { sourceId: currentSource?.id, episodeId: ep.id, count: parsed.length });
  } catch (e) {
    chaptersEl.innerHTML = "";
    chaptersMeta.textContent = "—";
    log(`Chapters fetch failed: ${String(e?.message || e)} — ${ext.url}`, "warn");
    dbg("chapters:external:error", { sourceId: currentSource?.id, episodeId: ep.id, url: ext.url });
  }
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

function updateButtons() {
  btnPlay.textContent = video.paused ? "Play" : "Pause";
}

function updateHud() {
  const ct = video.currentTime || 0;
  const dur = video.duration;
  const live = !Number.isFinite(dur) || dur === Infinity;
  hudTime.textContent = live ? fmtTime(ct) : `${fmtTime(ct)} / ${fmtTime(dur || 0)}`;

  if (!live && Number.isFinite(dur) && dur > 0.2) {
    const pct = clamp(ct / dur, 0, 1) * 100;
    progressFill.style.width = `${pct}%`;
  } else {
    progressFill.style.width = "0%";
  }
}

function tick() {
  if (!currentSource || !currentEp) return;
  updateButtons();
  updateHud();
  syncActiveChapter();

  const dur = video.duration;
  const live = !Number.isFinite(dur) || dur === Infinity;
  if (live) return;

  const now = performance.now();
  if (now - lastPersistMs < 1000) return;
  lastPersistMs = now;

  const ct = video.currentTime || 0;
  if (Number.isFinite(dur) && dur > 10 && ct > 0.5 && ct < dur - 1.5) {
    setProgressSec(currentSource.id, currentEp.id, ct);
  }
}

function wireUI() {
  btnPlay.addEventListener("click", () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  video.addEventListener("click", () => btnPlay.click());
  video.addEventListener("play", updateButtons);
  video.addEventListener("pause", updateButtons);

  progress.addEventListener("click", (e) => {
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur === Infinity || dur <= 0.2) return;
    const r = progress.getBoundingClientRect();
    const pct = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    video.currentTime = clamp(pct * dur, 0, Math.max(0, dur - 0.25));
  });

  feedSelect.addEventListener("change", () => {
    loadSource(feedSelect.value, { preserveEpisode: true });
  });

  if (btnClearLog) {
    btnClearLog.addEventListener("click", () => {
      logEntries.length = 0;
      if (logOutput) logOutput.innerHTML = "";
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === " ") {
      e.preventDefault();
      btnPlay.click();
    }
    if (k === "arrowleft") {
      e.preventDefault();
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      video.currentTime = Math.max(0, (video.currentTime || 0) - (e.shiftKey ? 20 : 5));
    }
    if (k === "arrowright") {
      e.preventDefault();
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      const dur = video.duration || 0;
      video.currentTime = Math.min(dur - 0.25, (video.currentTime || 0) + (e.shiftKey ? 20 : 5));
    }
    if (k === "f") {
      e.preventDefault();
      try {
        const wrap = $(".player");
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen?.();
      } catch {}
    }
    if (k === "m") {
      e.preventDefault();
      video.muted = !video.muted;
    }
  });
}

async function boot() {
  wireUI();
  setMsg("Loading sources…");

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
    setMsg(`Couldn't load ${SOURCES_URL}. If you're on file://, use a local http server.`);
    return;
  }

  log(`Loaded ${sources.length} sources`);

  if (!sources.length) {
    setMsg("No sources found in video-sources.json");
    return;
  }

  renderSources();
  const lastSource = sources.find(s => s.id === state.last?.sourceId)?.id;
  const initial = lastSource || sources[0].id;
  feedSelect.value = initial;
  await loadSource(initial, { preserveEpisode: true });

  setInterval(tick, 250);
}

boot();