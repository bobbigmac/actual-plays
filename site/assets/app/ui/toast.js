var TOAST_ROOT_ID = "ap-toast-root";
var lastToastSig = "";
var lastToastAt = 0;

function ensureRoot() {
  var root = document.getElementById(TOAST_ROOT_ID);
  if (root) return root;
  root = document.createElement("div");
  root.id = TOAST_ROOT_ID;
  root.className = "toast-root";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  document.body.appendChild(root);
  return root;
}

export function showToast(message, opts) {
  var text = String(message || "").trim();
  if (!text) return;

  var options = opts || {};
  var ttl = Number(options.ttlMs || 6000) || 6000;
  var sig = text.toLowerCase();
  var now = Date.now();
  if (sig === lastToastSig && now - lastToastAt < 3500) return;
  lastToastSig = sig;
  lastToastAt = now;

  var root = ensureRoot();
  var el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  root.appendChild(el);

  // Allow layout/transition.
  requestAnimationFrame(function () {
    el.classList.add("is-show");
  });

  setTimeout(function () {
    el.classList.remove("is-show");
    setTimeout(function () {
      try {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (_e) {}
    }, 250);
  }, ttl);
}

export function toastNetworkFailure(actionLabel) {
  var offline = typeof navigator !== "undefined" && navigator && navigator.onLine === false;
  var action = String(actionLabel || "Request").trim();
  var msg = offline ? "You appear to be offline. Try again when reconnected." : action + " failed to load. Try again.";
  showToast(msg);
}

