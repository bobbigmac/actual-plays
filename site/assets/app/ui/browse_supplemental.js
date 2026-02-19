import { $all, $ } from "../dom.js";
import { readBrowseShowSupplemental, writeBrowseShowSupplemental } from "../model.js";
import { getBasePath } from "../env.js";

var _bound = false;

function isHomePage() {
  var base = new URL(getBasePath(), window.location.origin);
  var p = window.location.pathname;
  return p === base.pathname || p === base.pathname + "index.html";
}

function apply() {
  if (!isHomePage()) return;
  var checked = readBrowseShowSupplemental();
  var cards = $all('.feed-card[data-supplemental="1"]');
  cards.forEach(function (c) {
    if (checked) c.removeAttribute("hidden");
    else c.setAttribute("hidden", "");
  });
  var toggle = $("#browse-show-supplemental");
  if (toggle) toggle.checked = checked;
}

export function initBrowseSupplementalUi(deps) {
  var onChanged = (deps && deps.onChanged) || function () {};
  if (!isHomePage()) return;

  apply();

  if (!_bound) {
    _bound = true;
    document.addEventListener("change", function (e) {
      var t = e && e.target ? e.target : null;
      if (!t) return;
      if (t.id !== "browse-show-supplemental") return;
      writeBrowseShowSupplemental(Boolean(t.checked));
      apply();
      onChanged();
    });
  }
}

export function applyBrowseSupplementalUi() {
  apply();
}
