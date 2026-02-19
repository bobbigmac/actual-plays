export function initCopyUi() {
  document.addEventListener("click", function (e) {
    var t = e && e.target ? e.target : null;
    if (!t || !t.closest) return;
    var btn = t.closest("[data-copy-text]");
    if (!btn) return;
    e.preventDefault();

    var text = String(btn.getAttribute("data-copy-text") || "");
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

