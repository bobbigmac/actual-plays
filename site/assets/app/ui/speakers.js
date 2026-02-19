import { $, $all } from "../dom.js";
import { readSpeakersIncludeOwn, writeSpeakersIncludeOwn } from "../model.js";

export function applySpeakersUi() {
  var includeOwn = readSpeakersIncludeOwn();

  var speakersToggle = $("#speakers-include-own");
  if (speakersToggle) {
    speakersToggle.checked = includeOwn;
    var mode = includeOwn ? "Including own podcasts" : "Guest only";
    var modeEl = $("[data-speakers-mode]");
    if (modeEl) modeEl.textContent = mode;
    var items = $all("[data-speaker-row]");
    items.forEach(function (li) {
      // Swap which stat row is visually primary to make the toggle obvious.
      var wrap = li.querySelector ? li.querySelector("[data-speaker-stats-wrap]") : null;
      if (!wrap || !wrap.querySelector) return;
      var guestRow = wrap.querySelector('[data-speaker-stats="guest"]');
      var totalRow = wrap.querySelector('[data-speaker-stats="total"]');
      if (!guestRow || !totalRow) return;
      try {
        if (includeOwn) {
          wrap.insertBefore(totalRow, guestRow);
          totalRow.setAttribute("data-primary", "1");
          guestRow.setAttribute("data-primary", "0");
        } else {
          wrap.insertBefore(guestRow, totalRow);
          guestRow.setAttribute("data-primary", "1");
          totalRow.setAttribute("data-primary", "0");
        }
      } catch (_e) {}
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

    var countsWrap = $(".speaker-counts");
    if (countsWrap) {
      var g = countsWrap.querySelector('[data-speaker-stats="guest"]');
      var t = countsWrap.querySelector('[data-speaker-stats="total"]');
      if (g && t) {
        try {
          if (includeOwn) {
            countsWrap.insertBefore(t, g);
            t.setAttribute("data-primary", "1");
            g.setAttribute("data-primary", "0");
          } else {
            countsWrap.insertBefore(g, t);
            g.setAttribute("data-primary", "1");
            t.setAttribute("data-primary", "0");
          }
        } catch (_e) {}
      }
    }
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
