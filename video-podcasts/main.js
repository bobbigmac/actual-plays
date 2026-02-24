
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

const STORAGE_KEY = "vodcast_hls_demo_v1";
const state = loadState();

const svgPoster = (title, a="#8ab4f8", b="#7ee787") => {
  const t = title.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${a}" stop-opacity=".9"/>
  <stop offset="1" stop-color="${b}" stop-opacity=".85"/>
</linearGradient>
<filter id="blur">
  <feGaussianBlur stdDeviation="18" />
</filter>
</defs>
<rect width="640" height="360" fill="#05060a"/>
<circle cx="120" cy="80" r="130" fill="url(#g)" filter="url(#blur)" opacity=".65"/>
<circle cx="540" cy="300" r="170" fill="url(#g)" filter="url(#blur)" opacity=".40"/>
<rect x="28" y="250" width="584" height="74" rx="18" fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.22)"/>
<text x="52" y="292" font-family="ui-sans-serif,system-ui" font-weight="700" font-size="28" fill="white">${t}</text>
<text x="52" y="318" font-family="ui-monospace,Menlo,Monaco,Consolas" font-size="14" fill="rgba(255,255,255,.75)">HLS · demo</text>
</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
};

const CATALOG = [
  {
    id: "mux",
    title: "Vodcast: Mux test stream",
    provider: "Mux",
    home: "https://test-streams.mux.dev/",
    poster: svgPoster("Mux test stream", "#8ab4f8", "#f2cc60"),
    episodes: [
      {
        id: "x36xhzz",
        title: "Episode 1 · x36xhzz",
        hls: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        notes: "Classic hls.js demo stream. Good for ABR + level switching.",
        chapters: [
          { t: 0, name: "Cold open" },
          { t: 45, name: "Bit where you squint at buffering" },
          { t: 110, name: "Somewhere in the middle" },
          { t: 220, name: "Closing vibes" },
        ],
      },
    ],
  },
  {
    id: "apple",
    title: "Vodcast: Apple fMP4 example",
    provider: "Apple",
    home: "https://developer.apple.com/streaming/examples/",
    poster: svgPoster("Apple fMP4", "#7ee787", "#8ab4f8"),
    episodes: [
      {
        id: "bipbop_fmp4",
        title: "Episode 1 · BipBop (fMP4)",
        hls: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
        notes: "Apple HLS example (fMP4). Handy for testing variant playlists + modern tags.",
        chapters: [
          { t: 0, name: "Start" },
          { t: 60, name: "Switch quality a few times" },
          { t: 150, name: "PiP + speed" },
          { t: 260, name: "End-ish" },
        ],
      },
    ],
  },
  {
    id: "unified",
    title: "Vodcast: Tears of Steel",
    provider: "Unified Streaming",
    home: "https://demo.unified-streaming.com/k8s/features/stable/",
    poster: svgPoster("Tears of Steel", "#f2cc60", "#ff7b72"),
    episodes: [
      {
        id: "tos_full",
        title: "Episode 1 · full stream",
        hls: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
        notes: "Unified Streaming demo. Great for HLS manifests that look like real production setups.",
        chapters: [
          { t: 0, name: "Intro" },
          { t: 90, name: "First act" },
          { t: 300, name: "Midpoint" },
          { t: 720, name: "Later" },
        ],
      },
      {
        id: "tos_clip",
        title: "Episode 2 · 60s clip (vbegin/vend)",
        hls: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8?vbegin=60&vend=120",
        notes: "Same stream, clipped by query params. Useful for your own 'chapters -> manifests' experiments.",
        chapters: [
          { t: 0, name: "Clip start" },
          { t: 20, name: "Beat" },
          { t: 40, name: "Beat" },
          { t: 58, name: "Clip end" },
        ],
      },
    ],
  },
  {
    id: "akamai",
    title: "Vodcast: Akamai live test",
    provider: "Akamai",
    home: "https://ottverse.com/free-hls-m3u8-test-urls/",
    poster: svgPoster("Akamai LIVE", "#ff7b72", "#8ab4f8"),
    episodes: [
      {
        id: "akamai_live",
        title: "Episode 1 · live stream",
        hls: "https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8",
        notes: "Live HLS. Duration will be Infinity; progress/resume behaves differently.",
        chapters: [
          { t: 0, name: "Live (no real chapters)" },
          { t: 0, name: "Try Go live button" },
          { t: 0, name: "Try quality switching" },
          { t: 0, name: "Try PiP" },
        ],
      },
    ],
  },
  {
    id: "ireplay",
    title: "Vodcast: iReplay Blender test",
    provider: "iReplay",
    home: "https://ottverse.com/free-hls-m3u8-test-urls/",
    poster: svgPoster("iReplay test", "#8ab4f8", "#7ee787"),
    episodes: [
      {
        id: "blender",
        title: "Episode 1 · blender.m3u8",
        hls: "https://ireplay.tv/test/blender.m3u8",
        notes: "Simple public HLS test stream from iReplay. Good for sanity checks.",
        chapters: [
          { t: 0, name: "Start" },
          { t: 30, name: "Seek around" },
          { t: 90, name: "Switch quality" },
          { t: 150, name: "Background + resume" },
        ],
      },
    ],
  },
];

const video = $("#video");
const showsEl = $("#shows");
const chaptersEl = $("#chapters");
const notesEl = $("#notes");
const leftMsg = $("#leftMsg");

const envPill = $("#envPill");
const nowTitle = $("#nowTitle");
const nowProvider = $("#nowProvider");
const pillLive = $("#pillLive");
const pillMode = $("#pillMode");
const epPill = $("#epPill");
const epSub = $("#epSub");

const seek = $("#seek");
const timeL = $("#timeL");
const timeR = $("#timeR");

const btnPlay = $("#btnPlay");
const btnBack = $("#btnBack");
const btnFwd = $("#btnFwd");
const btnLive = $("#btnLive");
const btnFs = $("#btnFs");
const btnPip = $("#btnPip");
const btnAudioOnly = $("#btnAudioOnly");
const btnShare = $("#btnShare");
const btnAddCustom = $("#btnAddCustom");
const btnReset = $("#btnReset");

const selRate = $("#selRate");
const selQuality = $("#selQuality");

const toast = $("#toast");

const statsNow = $("#statsNow");
const statsTech = $("#statsTech");
const statsBuf = $("#statsBuf");
const statsMsg = $("#statsMsg");

let hls = null;
let currentShow = null;
let currentEp = null;
let isSeeking = false;
let isAudioOnly = false;
let lastPersistAt = 0;

const isNativeHls = () => {
  const can = video.canPlayType("application/vnd.apple.mpegurl") || video.canPlayType("application/x-mpegURL");
  return can === "probably" || can === "maybe";
};

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return "00:00";
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  if (hh > 0) return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const showToast = (msg) => {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 850);
};

const copyText = async (txt) => {
  try {
    await navigator.clipboard.writeText(txt);
    showToast("Copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Copied");
  }
};

const setLeftMsg = (kind, text) => {
  leftMsg.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = kind === "err" ? "err" : "okmsg";
  div.textContent = text;
  leftMsg.appendChild(div);
};

const episodeKey = (showId, epId) => `${showId}::${epId}`;

function loadState(){
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getProgress(showId, epId){
  return (state.progress && state.progress[episodeKey(showId, epId)]) || 0;
}
function setProgress(showId, epId, t){
  state.progress ||= {};
  state.progress[episodeKey(showId, epId)] = t;
  state.last = { showId, epId, t, at: Date.now() };
  saveState();
}
function clearState(){
  localStorage.removeItem(STORAGE_KEY);
  location.hash = "";
  location.reload();
}

function parseHash(){
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const showId = params.get("show");
  const epId = params.get("ep");
  const t = Number(params.get("t") || "0");
  if (!showId || !epId) return null;
  return { showId, epId, t: Number.isFinite(t) ? Math.max(0, t) : 0 };
}

function setHash(showId, epId, t){
  const params = new URLSearchParams();
  params.set("show", showId);
  params.set("ep", epId);
  if (Number.isFinite(t) && t > 0.25) params.set("t", String(Math.floor(t)));
  location.hash = params.toString();
}

function mediaSession(show, ep){
  if (!("mediaSession" in navigator)) return;
  try{
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title,
      artist: show.provider,
      album: show.title,
      artwork: [{ src: show.poster, sizes: "640x360", type: "image/svg+xml" }],
    });
    const seekHandler = (details) => {
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      if (details.seekTime != null) video.currentTime = details.seekTime;
    };
    navigator.mediaSession.setActionHandler("play", () => video.play());
    navigator.mediaSession.setActionHandler("pause", () => video.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => video.currentTime -= 10);
    navigator.mediaSession.setActionHandler("seekforward", () => video.currentTime += 30);
    navigator.mediaSession.setActionHandler("seekto", seekHandler);
  } catch {}
}

function renderShows(){
  showsEl.innerHTML = "";
  for (const show of CATALOG){
    const el = document.createElement("div");
    el.className = "show";
    el.dataset.id = show.id;

    const th = document.createElement("div");
    th.className = "thumb";
    th.style.backgroundImage = `url("${show.poster}")`;

    const meta = document.createElement("div");
    meta.className = "meta";
    const t = document.createElement("p");
    t.className = "t";
    t.textContent = show.title;
    const d = document.createElement("p");
    d.className = "d";
    d.textContent = `${show.provider} · ${show.episodes.length} ep · ${new URL(show.episodes[0].hls).host}`;
    meta.append(t, d);

    el.append(th, meta);
    el.addEventListener("click", () => {
      const ep = show.episodes[0];
      loadEpisode(show.id, ep.id, { autoplay: true });
    });

    showsEl.appendChild(el);
  }
  syncActiveShow();
}

function syncActiveShow(){
  $$(".show", showsEl).forEach(el => {
    el.classList.toggle("active", currentShow && el.dataset.id === currentShow.id);
  });
}

function renderRates(){
  const rates = [0.75, 1, 1.25, 1.5, 1.75, 2];
  selRate.innerHTML = "";
  for (const r of rates){
    const opt = document.createElement("option");
    opt.value = String(r);
    opt.textContent = r === 1 ? "1×" : `${r}×`;
    selRate.appendChild(opt);
  }
  selRate.value = String(state.rate || 1);
  video.playbackRate = Number(selRate.value) || 1;
  selRate.addEventListener("change", () => {
    const r = Number(selRate.value) || 1;
    state.rate = r;
    video.playbackRate = r;
    saveState();
    showToast(`${r}×`);
  });
}

function resetQualityUI(disabledText="Quality"){
  selQuality.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = disabledText;
  selQuality.appendChild(opt);
  selQuality.value = "";
  selQuality.disabled = true;
}

function applyQualityOptions(levels){
  selQuality.innerHTML = "";
  selQuality.disabled = false;

  const auto = document.createElement("option");
  auto.value = "-1";
  auto.textContent = "Auto";
  selQuality.appendChild(auto);

  levels.forEach((lvl, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    const w = lvl?.width || 0;
    const h = lvl?.height || 0;
    const br = lvl?.bitrate ? Math.round(lvl.bitrate/1000) : null;
    const label = (w && h) ? `${h}p` : `L${idx}`;
    opt.textContent = br ? `${label} · ${br} kbps` : label;
    selQuality.appendChild(opt);
  });

  const remembered = state.quality?.[currentShow.id]?.[currentEp.id];
  selQuality.value = remembered != null ? String(remembered) : "-1";

  selQuality.onchange = () => {
    const v = Number(selQuality.value);
    state.quality ||= {};
    state.quality[currentShow.id] ||= {};
    state.quality[currentShow.id][currentEp.id] = v;
    saveState();
    if (hls) hls.currentLevel = v;
    showToast(v === -1 ? "Auto" : `Q${v}`);
  };
}

function teardown(){
  if (hls){
    try { hls.destroy(); } catch {}
    hls = null;
  }
  video.removeAttribute("src");
  try { video.load(); } catch {}
  resetQualityUI();
  pillLive.style.display = "none";
  btnLive.style.display = "none";
  pillMode.textContent = "HLS";
  setLeftMsg("", "");
  statsMsg.textContent = "";
}

function computeIsLive(){
  if (!currentEp) return false;
  if (Number.isFinite(video.duration) && video.duration !== Infinity) return false;
  if (hls && hls?.levels?.[0]?.details?.live) return true;
  if (video.duration === Infinity) return true;
  return false;
}

function renderEpisodePanel(){
  if (!currentShow || !currentEp){
    epPill.textContent = "—";
    epSub.textContent = "—";
    chaptersEl.innerHTML = "";
    notesEl.innerHTML = "";
    return;
  }
  epPill.textContent = currentEp.id;
  epSub.innerHTML = `<span class="mono">${currentShow.provider}</span> · <a href="${currentShow.home}" target="_blank" rel="noreferrer">source</a> · <span class="mono">${new URL(currentEp.hls).host}</span>`;

  notesEl.innerHTML = `
    <p><b>${escapeHtml(currentEp.title)}</b></p>
    <p class="muted">${escapeHtml(currentEp.notes || "")}</p>
    <p class="muted mono">${escapeHtml(currentEp.hls)}</p>
    <div class="divider" style="margin:12px 0"></div>
    <p class="muted">
      Stored progress: <span class="mono">${fmtTime(getProgress(currentShow.id, currentEp.id))}</span>
    </p>
    <p class="muted">Media Session set (if supported). Progress saved locally.</p>
  `;

  chaptersEl.innerHTML = "";
  (currentEp.chapters || []).forEach((c, idx) => {
    const el = document.createElement("div");
    el.className = "ch";
    el.dataset.idx = String(idx);
    el.innerHTML = `<div class="name">${escapeHtml(c.name)}</div><div class="t">${fmtTime(c.t)}</div>`;
    el.addEventListener("click", () => {
      if (!Number.isFinite(video.duration) || video.duration === Infinity) {
        showToast("Live stream");
        return;
      }
      video.currentTime = clamp(c.t, 0, Math.max(0, video.duration - 0.2));
      video.play().catch(()=>{});
    });
    chaptersEl.appendChild(el);
  });
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

async function loadEpisode(showId, epId, { autoplay=false, startAt=null } = {}){
  const show = CATALOG.find(s => s.id === showId);
  if (!show) return;
  const ep = show.episodes.find(e => e.id === epId) || show.episodes[0];
  if (!ep) return;

  teardown();
  currentShow = show;
  currentEp = ep;
  syncActiveShow();

  nowTitle.textContent = ep.title;
  nowProvider.textContent = show.provider;

  renderEpisodePanel();
  mediaSession(show, ep);

  state.last ||= {};
  state.last.showId = showId;
  state.last.epId = ep.id;
  saveState();

  const url = ep.hls;

  const usingNative = isNativeHls();
  const usingHlsJs = !usingNative && window.Hls && Hls.isSupported();

  envPill.textContent = usingNative ? "native HLS" : (usingHlsJs ? "hls.js" : "no hls");
  pillMode.textContent = usingNative ? "native" : (usingHlsJs ? "hls.js" : "none");

  if (!usingNative && !usingHlsJs){
    setLeftMsg("err", "No HLS support in this browser. Try Safari, or a modern Chromium/Firefox with hls.js allowed.");
    return;
  }

  // visuals (audio-only mode toggles object-fit + background vibe)
  applyAudioOnly(false);

  const desiredStart = (startAt != null ? startAt : getProgress(showId, ep.id)) || 0;

  if (usingNative){
    video.src = url;
    video.addEventListener("loadedmetadata", () => {
      const live = computeIsLive();
      pillLive.style.display = live ? "inline-flex" : "none";
      btnLive.style.display = live ? "inline-flex" : "none";

      if (!live && Number.isFinite(video.duration)){
        const t = clamp(desiredStart, 0, Math.max(0, video.duration - 0.25));
        if (t > 0.25) video.currentTime = t;
      }
      if (autoplay) video.play().catch(()=>{});
    }, { once:true });

    resetQualityUI("Quality (native)");
    setLeftMsg("ok", "Loaded via native HLS. Quality menu depends on browser.");
  } else {
    const cfg = {
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    };
    hls = new Hls(cfg);

    hls.on(Hls.Events.ERROR, (evt, data) => {
      const msg = data?.details ? `${data.type} · ${data.details}` : (data?.type || "error");
      setLeftMsg("err", `HLS error: ${msg}`);
      if (data?.fatal){
        try{
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR){
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR){
            hls.recoverMediaError();
          } else {
            hls.destroy();
          }
        } catch {}
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      applyQualityOptions(hls.levels || []);
      setLeftMsg("ok", "Loaded via hls.js. Quality menu is active.");
      if (autoplay) video.play().catch(()=>{});
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, () => {
      const lvl = hls.levels?.[hls.currentLevel];
      if (lvl){
        const label = lvl.height ? `${lvl.height}p` : `L${hls.currentLevel}`;
        statsMsg.textContent = `level: ${label}`;
      } else {
        statsMsg.textContent = `level: auto`;
      }
    });

    hls.on(Hls.Events.LEVEL_LOADED, () => {
      const live = computeIsLive();
      pillLive.style.display = live ? "inline-flex" : "none";
      btnLive.style.display = live ? "inline-flex" : "none";
    });

    hls.loadSource(url);
    hls.attachMedia(video);

    // resume once duration is known (for VOD)
    const resumeOnce = () => {
      const live = computeIsLive();
      if (!live && Number.isFinite(video.duration) && video.duration > 1){
        const t = clamp(desiredStart, 0, Math.max(0, video.duration - 0.25));
        if (t > 0.25) video.currentTime = t;
      }
    };
    video.addEventListener("loadedmetadata", resumeOnce, { once:true });
  }

  setHash(showId, ep.id, desiredStart);
  updateButtons();
  renderEpisodePanel();
}

function updateButtons(){
  btnPlay.textContent = video.paused ? "Play" : "Pause";
  btnPip.disabled = !document.pictureInPictureEnabled || !video;
  btnAudioOnly.textContent = isAudioOnly ? "Video" : "Audio-only";
}

function applyAudioOnly(on){
  isAudioOnly = on;
  if (on){
    video.style.objectFit = "contain";
    video.style.filter = "brightness(.85) saturate(.9)";
    video.style.opacity = "0.0001";
    video.style.pointerEvents = "none";
    video.parentElement.style.background =
      `radial-gradient(900px 420px at 30% 20%, rgba(138,180,248,.20), transparent 58%),
       radial-gradient(800px 400px at 75% 70%, rgba(126,231,135,.14), transparent 55%),
       #05060a`;
  } else {
    video.style.opacity = "1";
    video.style.pointerEvents = "auto";
    video.style.filter = "none";
    video.parentElement.style.background = "#05060a";
  }
  updateButtons();
}

function activeChapterIdx(){
  if (!currentEp?.chapters?.length) return -1;
  const t = video.currentTime || 0;
  let idx = 0;
  for (let i=0;i<currentEp.chapters.length;i++){
    if (currentEp.chapters[i].t <= t + 0.001) idx = i;
  }
  return idx;
}

function syncChapters(){
  const idx = activeChapterIdx();
  $$(".ch", chaptersEl).forEach(el => el.classList.toggle("active", Number(el.dataset.idx) === idx));
}

function bufferedRanges(){
  try{
    const b = video.buffered;
    if (!b || b.length === 0) return "—";
    const parts = [];
    for (let i=0;i<b.length;i++){
      parts.push(`[${fmtTime(b.start(i))}..${fmtTime(b.end(i))}]`);
    }
    return parts.join(" ");
  } catch {
    return "—";
  }
}

function updateStats(){
  if (!currentShow || !currentEp) return;
  const live = computeIsLive();
  const dur = live ? "∞" : fmtTime(video.duration || 0);
  const ct = fmtTime(video.currentTime || 0);
  const res = `${video.videoWidth || 0}x${video.videoHeight || 0}`;
  statsNow.textContent =
`show: ${currentShow.id}
ep:   ${currentEp.id}
time: ${ct} / ${dur}
res:  ${res}
rate: ${video.playbackRate.toFixed(2)}x
muted:${video.muted ? "yes" : "no"}
live: ${live ? "yes" : "no"}`;

  const q = (() => {
    try {
      const pq = video.getVideoPlaybackQuality?.();
      if (!pq) return "—";
      return `dropped: ${pq.droppedVideoFrames} / total: ${pq.totalVideoFrames}`;
    } catch { return "—"; }
  })();

  let h = "—";
  if (hls){
    const est = hls.bandwidthEstimate ? Math.round(hls.bandwidthEstimate/1000) : null;
    const cur = (hls.currentLevel ?? -1);
    const next = (hls.nextLevel ?? -1);
    const lvl = hls.levels?.[cur];
    const lbl = cur === -1 ? "auto" : (lvl?.height ? `${lvl.height}p` : `L${cur}`);
    h =
`player: hls.js
level:  ${lbl}
next:   ${next}
bw:     ${est ? est + " kbps" : "—"}
tracks: ${hls.audioTracks?.length ?? 0}
${q}`;
  } else {
    h =
`player: native
quality: (browser-managed)
${q}`;
  }
  statsTech.textContent = h;
  statsBuf.textContent = bufferedRanges();
}

function tickUI(){
  if (!currentShow || !currentEp) return;

  const live = computeIsLive();
  pillLive.style.display = live ? "inline-flex" : "none";
  btnLive.style.display = live ? "inline-flex" : "none";

  const ct = video.currentTime || 0;
  const dur = video.duration;

  timeL.textContent = fmtTime(ct);
  timeR.textContent = live ? "LIVE" : fmtTime(dur || 0);

  if (!isSeeking){
    if (!live && Number.isFinite(dur) && dur > 0.3){
      const v = Math.round((ct / dur) * 1000);
      seek.value = String(clamp(v, 0, 1000));
    } else {
      seek.value = "0";
    }
  }

  syncChapters();
  updateButtons();
  updateStats();

  const now = performance.now();
  if (!live && currentShow && currentEp && now - lastPersistAt > 1100){
    lastPersistAt = now;
    if (Number.isFinite(dur) && dur > 10 && ct > 0.5 && ct < dur - 1.5){
      setProgress(currentShow.id, currentEp.id, ct);
      setHash(currentShow.id, currentEp.id, ct);
    }
  }
}

function hookTabs(){
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.tab;
      $("#paneChapters").style.display = which === "chapters" ? "" : "none";
      $("#paneNotes").style.display = which === "notes" ? "" : "none";
      $("#paneStats").style.display = which === "stats" ? "" : "none";
    });
  });
}

function wireControls(){
  btnPlay.addEventListener("click", () => {
    if (video.paused) video.play().catch(()=>{});
    else video.pause();
  });

  btnBack.addEventListener("click", () => {
    if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
    video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
  });

  btnFwd.addEventListener("click", () => {
    if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
    const dur = video.duration || 0;
    video.currentTime = Math.min(dur - 0.25, (video.currentTime || 0) + 30);
  });

  btnLive.addEventListener("click", () => {
    if (!hls) return;
    try {
      const d = hls?.levels?.[hls.currentLevel]?.details || hls?.levels?.[0]?.details;
      if (d?.live){
        // best effort: seek to the end of buffer
        try{
          const b = video.buffered;
          if (b && b.length) video.currentTime = b.end(b.length - 1) - 0.2;
        } catch {}
      }
    } catch {}
    showToast("Live");
  });

  btnFs.addEventListener("click", async () => {
    try{
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $(".playerWrap").requestFullscreen();
    } catch {}
  });

  btnPip.addEventListener("click", async () => {
    try{
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {}
  });

  btnAudioOnly.addEventListener("click", () => {
    applyAudioOnly(!isAudioOnly);
  });

  btnShare.addEventListener("click", async () => {
    if (!currentShow || !currentEp) return;
    const t = Math.floor(video.currentTime || 0);
    const url = new URL(location.href);
    url.hash = "";
    url.hash = new URLSearchParams({ show: currentShow.id, ep: currentEp.id, t: String(t) }).toString();
    await copyText(url.toString());
  });

  seek.addEventListener("input", () => {
    if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
    isSeeking = true;
    const dur = video.duration || 0;
    const pct = Number(seek.value) / 1000;
    const t = clamp(pct * dur, 0, Math.max(0, dur - 0.25));
    timeL.textContent = fmtTime(t);
  });

  seek.addEventListener("change", () => {
    if (!Number.isFinite(video.duration) || video.duration === Infinity) {
      isSeeking = false;
      return;
    }
    const dur = video.duration || 0;
    const pct = Number(seek.value) / 1000;
    const t = clamp(pct * dur, 0, Math.max(0, dur - 0.25));
    video.currentTime = t;
    isSeeking = false;
  });

  video.addEventListener("play", updateButtons);
  video.addEventListener("pause", updateButtons);
  video.addEventListener("timeupdate", () => { /* tickUI handles persist */ });
  video.addEventListener("loadedmetadata", () => {
    if (!Number.isFinite(video.duration) || video.duration === Infinity) {
      resetQualityUI(hls ? "Quality" : "Quality (native)");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;

    const k = e.key.toLowerCase();
    if (k === " "){
      e.preventDefault();
      if (video.paused) video.play().catch(()=>{});
      else video.pause();
    }
    if (k === "arrowleft"){
      e.preventDefault();
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      video.currentTime = Math.max(0, (video.currentTime || 0) - (e.shiftKey ? 20 : 5));
    }
    if (k === "arrowright"){
      e.preventDefault();
      if (!Number.isFinite(video.duration) || video.duration === Infinity) return;
      const dur = video.duration || 0;
      video.currentTime = Math.min(dur - 0.25, (video.currentTime || 0) + (e.shiftKey ? 20 : 5));
    }
    if (k === "f"){
      e.preventDefault();
      btnFs.click();
    }
    if (k === "p"){
      e.preventDefault();
      btnPip.click();
    }
    if (k === "m"){
      e.preventDefault();
      video.muted = !video.muted;
      showToast(video.muted ? "Muted" : "Unmuted");
    }
    if (k === "]" || k === "="){
      e.preventDefault();
      const r = clamp((video.playbackRate || 1) + 0.25, 0.5, 3);
      video.playbackRate = r;
      selRate.value = String(r);
      state.rate = r;
      saveState();
      showToast(`${r}×`);
    }
    if (k === "[" || k === "-"){
      e.preventDefault();
      const r = clamp((video.playbackRate || 1) - 0.25, 0.5, 3);
      video.playbackRate = r;
      selRate.value = String(r);
      state.rate = r;
      saveState();
      showToast(`${r}×`);
    }
  });
}

function wireCustom(){
  btnAddCustom.addEventListener("click", async () => {
    const url = prompt("Paste a .m3u8 URL (must allow CORS):");
    if (!url) return;

    const id = "custom_" + Math.random().toString(16).slice(2);
    const show = {
      id,
      title: "Vodcast: custom",
      provider: "Custom",
      home: location.href,
      poster: svgPoster("Custom", "#8ab4f8", "#ff7b72"),
      episodes: [
        {
          id: "custom_ep",
          title: "Episode 1 · custom URL",
          hls: url.trim(),
          notes: "User-supplied stream.",
          chapters: [
            { t: 0, name: "Start" },
            { t: 30, name: "Chapter 2" },
            { t: 60, name: "Chapter 3" },
            { t: 120, name: "Chapter 4" },
          ],
        },
      ],
    };

    CATALOG.unshift(show);
    renderShows();
    setLeftMsg("ok", "Added custom stream to the top.");
    await loadEpisode(show.id, show.episodes[0].id, { autoplay: true, startAt: 0 });
  });

  btnReset.addEventListener("click", () => {
    if (confirm("Reset local progress + settings?")) clearState();
  });
}

function boot(){
  renderShows();
  renderRates();
  resetQualityUI();

  hookTabs();
  wireControls();
  wireCustom();

  const fromHash = parseHash();
  const last = state.last;

  const showId = fromHash?.showId || last?.showId || CATALOG[0].id;
  const epId = fromHash?.epId || last?.epId || CATALOG.find(s=>s.id===showId)?.episodes?.[0]?.id;
  const startAt = fromHash?.t ?? null;

  loadEpisode(showId, epId, { autoplay: false, startAt });

  setInterval(tickUI, 250);
}

boot();