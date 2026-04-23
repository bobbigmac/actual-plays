import { resolveUrlMaybeRelative } from "../util/url.js";

function refreshRssPanel(panel) {
  if (!panel || !panel.querySelector) return;

  var input = panel.querySelector(".rss-input");
  var raw = "";
  if (input) raw = String(input.getAttribute("value") || input.value || "").trim();
  if (!raw) return;

  var resolved = resolveUrlMaybeRelative(raw);
  if (input) {
    input.value = resolved;
    input.setAttribute("value", resolved);
  }

  var copyBtn = panel.querySelector("[data-copy-text]");
  if (copyBtn) copyBtn.setAttribute("data-copy-text", resolved);

  var shareBtn = panel.querySelector("[data-share-url]");
  if (shareBtn) shareBtn.setAttribute("data-share-url", resolved);

  var androidLink = panel.querySelector("[data-android-intent][data-intent-url]");
  if (androidLink) androidLink.setAttribute("data-intent-url", resolved);

  var iosLink = panel.querySelector("[data-ios-feed][data-feed-url]");
  if (iosLink) iosLink.setAttribute("data-feed-url", resolved);
}

export function refreshCopyUi(root) {
  var scope = root || document;
  if (!scope || !scope.querySelectorAll) return;
  var panels = scope.querySelectorAll(".subscribe-panel");
  for (var i = 0; i < panels.length; i++) {
    refreshRssPanel(panels[i]);
  }
}

export function initCopyUi() {
  document.addEventListener("click", function (e) {
    var t = e && e.target ? e.target : null;
    if (!t || !t.closest) return;
    var btn = t.closest("[data-copy-text]");
    if (!btn) return;
    e.preventDefault();

    var text = String(btn.getAttribute("data-copy-text") || "");
    var panel = btn.closest ? btn.closest(".subscribe-panel") : null;
    if (panel) {
      var input = panel.querySelector(".rss-input");
      if (input) text = String(input.value || input.getAttribute("value") || text || "");
    }
    text = resolveUrlMaybeRelative(text);
    if (!text) return;

    function flash(label) {
      var prev = btn.textContent;
      btn.textContent = label;
      setTimeout(function () {
        btn.textContent = prev;
      }, 900);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          flash("Copied");
        })
        .catch(function () {
          flash("Copy failed");
        });
      return;
    }

    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flash("Copied");
    } catch (_err) {
      flash("Copy failed");
    }
  });

  document.addEventListener("focusin", function (e) {
    var t = e && e.target ? e.target : null;
    if (!t) return;
    if (t && t.classList && t.classList.contains("rss-input") && t.select) {
      t.select();
    }
  });
}
