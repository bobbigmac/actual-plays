import { getBasePath } from "./env.js";

export function initPwa() {
  if (!("serviceWorker" in navigator)) return;

  function register() {
    var basePath = getBasePath();
    var url = basePath + "sw.js";
    try {
      console.log("[pwa] registering", { url: url, scope: basePath });
    } catch (_e) {}
    navigator.serviceWorker
      .register(url, { scope: basePath })
      .then(function (reg) {
        try {
          // Ensure updates are checked immediately so stale cached modules are replaced quickly.
          if (reg && reg.update) reg.update();
        } catch (_e0) {}
        try {
          console.log("[pwa] registered", {
            scope: reg && reg.scope,
            active: Boolean(reg && reg.active),
            installing: Boolean(reg && reg.installing),
            waiting: Boolean(reg && reg.waiting),
          });
        } catch (_e2) {}
      })
      .catch(function (err) {
        try {
          console.warn("[pwa] register failed", err);
        } catch (_e3) {}
      });

    try {
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        try {
          console.log("[pwa] controllerchange", {
            hasController: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
          });
        } catch (_e4) {}
      });
    } catch (_e5) {}
  }

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register);
  }
}
