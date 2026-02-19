import { $all } from "../dom.js";

export function initMenus() {
  function closeAll(except) {
    $all("details.menu[open]").forEach(function (d) {
      if (except && d === except) return;
      d.open = false;
    });
  }

  document.addEventListener("toggle", function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("menu")) return;
    if (t.open) closeAll(t);
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("details.menu")) return;
    closeAll(null);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll(null);
  });
}

