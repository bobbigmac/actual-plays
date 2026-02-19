import { $all } from "../dom.js";

export function initDescriptions() {
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (!t.hasAttribute("data-desc-toggle")) return;
    e.preventDefault();

    var wrap = t.closest ? t.closest("[data-desc-wrap]") : null;
    if (!wrap) return;
    var snip = wrap.querySelector("[data-desc-snippet]");
    var full = wrap.querySelector("[data-desc-full]");
    if (!snip || !full) return;

    var open = !full.hasAttribute("hidden");
    if (open) {
      full.setAttribute("hidden", "");
      snip.removeAttribute("hidden");
    } else {
      snip.setAttribute("hidden", "");
      full.removeAttribute("hidden");
    }

    // Keep aria-expanded consistent for both buttons if present.
    $all("[data-desc-toggle]", wrap).forEach(function (btn) {
      btn.setAttribute("aria-expanded", open ? "false" : "true");
    });
  });
}

