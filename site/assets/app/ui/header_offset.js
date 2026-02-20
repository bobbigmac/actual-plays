import { $ } from "../dom.js";

export function initHeaderOffset() {
  var header = $(".site-header");
  if (!header) return;

  var ticking = false;

  function isScrolled() {
    return (window.scrollY || 0) > 8;
  }

  function setVar() {
    var scrolled = isScrolled();
    document.documentElement.classList.toggle("ap-scrolled", scrolled);

    // CSS uses: top: calc(var(--header-offset) - 1px)
    // Use 1px when scrolled so the player lands at 0px.
    var h = scrolled ? 1 : header.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty("--header-offset", h.toFixed(2) + "px");
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      setVar();
    });
  }

  setVar();
  requestAnimationFrame(setVar);

  // Some browsers adjust metrics slightly once fonts finish loading.
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    document.fonts.ready.then(setVar).catch(function () {});
  }

  window.addEventListener("resize", setVar);
  window.addEventListener("scroll", onScroll, { passive: true });

  if ("ResizeObserver" in window) {
    try {
      new ResizeObserver(setVar).observe(header);
    } catch (_e) {}
  }
}
