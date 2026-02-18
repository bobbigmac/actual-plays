function $(sel, root) {
  return (root || document).querySelector(sel);
}

function esc(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtMs(ms) {
  var n = Math.max(0, Math.floor(Number(ms) || 0));
  if (n < 1000) return n + "ms";
  return (n / 1000).toFixed(2) + "s";
}

function ensurePanel() {
  var host = $("#client-panels") || document.body;
  var el = $("#dev-status");
  if (el) return el;

  el = document.createElement("section");
  el.id = "dev-status";
  el.className = "card dev-status";
  el.innerHTML =
    '<div class="dev-status-row">' +
    '  <div class="dev-status-title">Dev pipeline</div>' +
    '  <div class="dev-status-pill muted" data-pill>waiting…</div>' +
    "</div>" +
    '<div class="dev-status-log muted" data-log></div>';
  host.prepend(el);
  return el;
}

function setStatus(msg, detail) {
  var el = ensurePanel();
  el.querySelector("[data-pill]").textContent = msg || "";
  el.querySelector("[data-log]").textContent = detail || "";
}

function setError(msg, detail) {
  var el = ensurePanel();
  var pill = el.querySelector("[data-pill]");
  pill.textContent = msg || "error";
  pill.classList.remove("muted");
  pill.classList.add("dev-error");
  el.querySelector("[data-log]").textContent = detail || "";
}

function clearErrorStyle() {
  var el = $("#dev-status");
  if (!el) return;
  var pill = el.querySelector("[data-pill]");
  pill.classList.remove("dev-error");
  pill.classList.add("muted");
}

function onEvent(data) {
  if (!data) return;
  var stage = data.stage || "build";
  var status = data.status || "";
  var ms = data.ms != null ? fmtMs(data.ms) : "";
  var reason = data.reason ? " (" + data.reason + ")" : "";

  if (status === "start") {
    clearErrorStyle();
    setStatus(stage + ": running" + reason, data.file ? "trigger: " + data.file : "");
  } else if (status === "done") {
    clearErrorStyle();
    setStatus(stage + ": done" + (ms ? " · " + ms : "") + reason, data.file ? "trigger: " + data.file : "");
  } else if (status === "skip") {
    clearErrorStyle();
    setStatus(stage + ": skipped" + reason, data.file ? "trigger: " + data.file : "");
  } else if (status === "error") {
    setError(stage + ": error" + reason, data.error || "");
  }
}

// Vite custom WS events.
if (import.meta.hot) {
  import.meta.hot.on("ap:status", onEvent);
}

