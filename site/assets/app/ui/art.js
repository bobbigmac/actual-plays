import { esc } from "../dom.js";

var PLACEHOLDER_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function hueFromSeed(seed) {
  var s = String(seed || "");
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 160 + (Math.abs(h) % 180);
}

function initialsFromText(text) {
  var parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  var out = parts
    .map(function (p) {
      return (p[0] || "").toUpperCase();
    })
    .join("");
  return out.slice(0, 2) || "P";
}

export function artHtml(imageUrl, seedText) {
  var img = String(imageUrl || "").trim();
  if (img)
    return (
      '<img src="' +
      PLACEHOLDER_SRC +
      '" data-src="' +
      esc(img) +
      '" data-fallback-text="' +
      esc(String(seedText || "")) +
      '" alt="" loading="lazy" decoding="async" fetchpriority="low" />'
    );
  var hue = hueFromSeed(seedText);
  return '<div class="cover-fallback" style="--cover-hue: ' + hue + '">' + esc(initialsFromText(seedText)) + "</div>";
}

export function makeCoverFallbackEl(seedText) {
  var el = document.createElement("div");
  el.className = "cover-fallback";
  el.style.setProperty("--cover-hue", String(hueFromSeed(seedText)));
  el.textContent = initialsFromText(seedText);
  return el;
}
