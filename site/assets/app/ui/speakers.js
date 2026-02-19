import { $, $all } from "../dom.js";
import { readSpeakersIncludeOwn, writeSpeakersIncludeOwn } from "../model.js";

export function applySpeakersUi() {
  var includeOwn = readSpeakersIncludeOwn();

  var speakersToggle = $("#speakers-include-own");
  if (speakersToggle) {
    speakersToggle.checked = includeOwn;
    var items = $all("[data-speaker-row]");
    items.forEach(function (li) {
      var guest = Number(li.getAttribute("data-count-guest") || 0) || 0;
      var total = Number(li.getAttribute("data-count-total") || 0) || 0;
      var guestPods = Number(li.getAttribute("data-pods-guest") || 0) || 0;
      var totalPods = Number(li.getAttribute("data-pods-total") || 0) || 0;
      var count = includeOwn ? total : guest;
      var pods = includeOwn ? totalPods : guestPods;
      var out = li.querySelector("[data-speaker-count]");
      if (out) out.textContent = String(count);
      var outPods = li.querySelector("[data-speaker-pods]");
      if (outPods) outPods.textContent = String(pods);
    });

    var ul = items.length ? items[0].parentElement : null;
    if (ul) {
      items
        .slice()
        .sort(function (a, b) {
          var an = Number(a.getAttribute(includeOwn ? "data-count-total" : "data-count-guest") || 0) || 0;
          var bn = Number(b.getAttribute(includeOwn ? "data-count-total" : "data-count-guest") || 0) || 0;
          if (bn !== an) return bn - an;
          var aName = String(a.getAttribute("data-name") || "").toLowerCase();
          var bName = String(b.getAttribute("data-name") || "").toLowerCase();
          if (aName < bName) return -1;
          if (aName > bName) return 1;
          return 0;
        })
        .forEach(function (li) {
          ul.appendChild(li);
        });
    }
  }

  var speakerToggle = $("#speaker-include-own");
  if (speakerToggle) {
    speakerToggle.checked = includeOwn;
    $all(".speaker-group[data-own='1']").forEach(function (d) {
      if (includeOwn) d.removeAttribute("hidden");
      else d.setAttribute("hidden", "");
    });
  }
}

export function initSpeakersUi() {
  applySpeakersUi();
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "speakers-include-own" || t.id === "speaker-include-own") {
      writeSpeakersIncludeOwn(Boolean(t.checked));
      applySpeakersUi();
    }
  });
}
