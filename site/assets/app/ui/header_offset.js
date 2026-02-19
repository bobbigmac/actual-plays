import { $ } from "../dom.js";

export function initHeaderOffset() {
  var header = $(".site-header");
  if (!header) return;

  function setVar() {
    var h = header.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty("--header-offset", h.toFixed(2) + "px");
  }

  setVar();
  requestAnimationFrame(setVar);

  // Some browsers adjust metrics slightly once fonts finish loading.
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    document.fonts.ready.then(setVar).catch(function () {});
  }

  window.addEventListener("resize", setVar);

  if ("ResizeObserver" in window) {
    try {
      new ResizeObserver(setVar).observe(header);
    } catch (_e) {}
  }
}
