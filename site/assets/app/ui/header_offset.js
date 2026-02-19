import { $ } from "../dom.js";

export function initHeaderOffset() {
  function setVar() {
    var header = $(".site-header");
    if (!header) return;
    var h = header.getBoundingClientRect().height || 0;
    // Extra breathing room so the player doesn't kiss the header border.
    document.documentElement.style.setProperty("--header-offset", Math.ceil(h + 10) + "px");
  }
  setVar();
  window.addEventListener("resize", setVar);
}

