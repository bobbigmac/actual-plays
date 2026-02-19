function isAndroid() {
  try {
    return /Android/i.test(navigator.userAgent || "");
  } catch (_e) {
    return false;
  }
}

function isIOS() {
  try {
    var ua = String(navigator.userAgent || "");
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ can masquerade as Mac; detect touch.
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
    return false;
  } catch (_e) {
    return false;
  }
}

function androidIntentHref(url) {
  try {
    var u = new URL(url, window.location.href);
    var scheme = (u.protocol || "https:").replace(":", "");
    return (
      "intent://" +
      u.host +
      u.pathname +
      u.search +
      "#Intent;scheme=" +
      scheme +
      ";action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end"
    );
  } catch (_e) {
    return "";
  }
}

function iosFeedHref(url) {
  try {
    var u = new URL(url, window.location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return "feed:" + u.toString();
  } catch (_e) {
    return "";
  }
}

export function initShareUi() {
  // Wire Android intent links (hidden by default).
  if (isAndroid()) {
    var links = document.querySelectorAll("[data-android-intent][data-intent-url]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var url = String(a.getAttribute("data-intent-url") || "");
      var href = androidIntentHref(url);
      if (!href) continue;
      a.setAttribute("href", href);
      a.hidden = false;
    }
  }

  // Best-effort iOS "feed:" links (hidden by default).
  if (isIOS()) {
    var iosLinks = document.querySelectorAll("[data-ios-feed][data-feed-url]");
    for (var j = 0; j < iosLinks.length; j++) {
      var a2 = iosLinks[j];
      var url2 = String(a2.getAttribute("data-feed-url") || "");
      var href2 = iosFeedHref(url2);
      if (!href2) continue;
      a2.setAttribute("href", href2);
      a2.hidden = false;
    }
  }

  // Wire Web Share buttons.
  document.addEventListener("click", function (e) {
    var t = e && e.target ? e.target : null;
    if (!t || !t.closest) return;
    var btn = t.closest("[data-share-url]");
    if (!btn) return;
    e.preventDefault();

    var url = String(btn.getAttribute("data-share-url") || "");
    if (!url) return;
    var title = String(btn.getAttribute("data-share-title") || "");

    if (navigator.share) {
      navigator
        .share({
          title: title || undefined,
          text: title || undefined,
          url: url,
        })
        .catch(function () {});
      return;
    }

    // Fallback: copy to clipboard if available.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(function () {});
    }
  });
}
