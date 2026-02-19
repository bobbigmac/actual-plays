export function $(sel, root) {
  return (root || document).querySelector(sel);
}

export function $all(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

export function esc(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, function (c) {
    return "\\" + c;
  });
}

