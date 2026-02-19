import { $all, $ } from "../dom.js";
import { readLatestShowSupplemental, writeLatestShowSupplemental } from "../model.js";
import { getBasePath } from "../env.js";

var _bound = false;

function isHomePage() {
  var base = new URL(getBasePath(), window.location.origin);
  var p = window.location.pathname;
  return p === base.pathname || p === base.pathname + "index.html";
}

function apply() {
  if (!isHomePage()) return;
  var checked = readLatestShowSupplemental();
  var rows = $all('#home-latest .episode-row[data-supplemental="1"]');
  rows.forEach(function (r) {
    if (checked) r.removeAttribute("hidden");
    else r.setAttribute("hidden", "");
  });
  var toggle = $("#latest-show-supplemental");
  if (toggle) toggle.checked = checked;

  var label = document.querySelector(
    '[data-toggle-label-for="latest-show-supplemental"] [data-toggle-label]',
  );
  if (label) {
    var count = rows.length || 0;
    label.textContent = checked
      ? "Hide supplemental episodes"
      : count
        ? "Show " + count + " supplemental episodes"
        : "Show supplemental episodes";
  }
}

export function initLatestSupplementalUi(deps) {
  var onChanged = (deps && deps.onChanged) || function () {};
  if (!isHomePage()) return;

  apply();

  if (!_bound) {
    _bound = true;
    document.addEventListener("change", function (e) {
      var t = e && e.target ? e.target : null;
      if (!t) return;
      if (t.id !== "latest-show-supplemental") return;
      writeLatestShowSupplemental(Boolean(t.checked));
      apply();
      onChanged();
    });
  }
}

export function applyLatestSupplementalUi() {
  apply();
}
