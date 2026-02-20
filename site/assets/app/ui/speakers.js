import { $, $all } from "../dom.js";
import { qs, setQs } from "../util/url.js";

export function applySpeakersUi() {
  // Speakers index filter only; ordering is server-rendered.
  var filter = $("#speakers-filter");
  if (!filter) return;

  var statusEl = $("#speakers-filter-status");
  var q = String(filter.value || "").trim().toLowerCase();
  var items = $all("[data-speaker-row]");
  var shown = 0;

  items.forEach(function (el) {
    var name = String(el.getAttribute("data-name") || "").toLowerCase();
    var hit = !q || name.includes(q);
    if (hit) {
      el.removeAttribute("hidden");
      shown += 1;
    } else {
      el.setAttribute("hidden", "");
    }
  });

  if (statusEl) statusEl.textContent = shown + " / " + items.length;
}

export function initSpeakersUi() {
  // Restore filter from querystring when on the speakers index.
  var filter0 = $("#speakers-filter");
  if (filter0 && !filter0.getAttribute("data-init")) {
    filter0.setAttribute("data-init", "1");
    var v0 = qs("sf") || "";
    if (v0) filter0.value = v0;
  }

  applySpeakersUi();

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id !== "speakers-filter") return;
    setQs("sf", String(t.value || "").trim() || null);
    applySpeakersUi();
  });
}
