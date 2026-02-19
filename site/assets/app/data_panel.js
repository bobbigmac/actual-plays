export function initDataPanel(deps) {
  if (window.__AP_DATA_PANEL_INIT__) return;
  window.__AP_DATA_PANEL_INIT__ = true;

  var $ = deps.$;
  var $all = deps.$all;
  var LS_PREFIX = String(deps.LS_PREFIX || "ap.v2.default.");
  var lsGet = deps.lsGet;
  var loadHistory = deps.loadHistory;
  var saveHistory = deps.saveHistory;
  var loadQueue = deps.loadQueue;
  var saveQueue = deps.saveQueue;
  var readProgress = deps.readProgress;
  var writeProgressObj = deps.writeProgressObj;
  var refreshAllProgress = deps.refreshAllProgress;
  var renderHomePanels = deps.renderHomePanels;
  var refreshQueueIndicators = deps.refreshQueueIndicators;

  var readOfflineSettings = deps.readOfflineSettings;
  var writeOfflineSettings = deps.writeOfflineSettings;
  var refreshOfflineStatus = deps.refreshOfflineStatus;
  var maybeAutoCacheQueue = deps.maybeAutoCacheQueue;

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[data]");
      console.log.apply(console, args);
    } catch (_e) {}
  }

  function warn() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[data]");
      console.warn.apply(console, args);
    } catch (_e) {}
  }

  function setText(sel, text) {
    var el = $(sel);
    if (!el) return;
    el.textContent = String(text || "");
  }

  function progressKeyPrefix() {
    return LS_PREFIX + "p:";
  }

  function computeDataInfo() {
    var history = loadHistory();
    var queue = loadQueue();
    var lsTotal = 0;
    var lsAp = 0;
    var progressCount = 0;
    try {
      lsTotal = localStorage.length;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (String(k).startsWith(LS_PREFIX)) lsAp++;
        if (String(k).startsWith(progressKeyPrefix())) progressCount++;
      }
    } catch (_e) {}
    return {
      history: (history || []).filter(function (x) { return x && x.id; }).length,
      queue: (queue || []).filter(function (x) { return x && x.id; }).length,
      lsTotal: lsTotal,
      lsAp: lsAp,
      progress: progressCount,
    };
  }

  function renderDataInfo() {
    var info = computeDataInfo();
    setText(
      "#data-info",
      "History: " +
        info.history +
        " · Queue: " +
        info.queue +
        " · Progress entries: " +
        info.progress +
        " · LocalStorage keys: " +
        info.lsAp +
        " (of " +
        info.lsTotal +
        ")"
    );
    return info;
  }

  function openData() {
    var modal = $("#data-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "data-modal";
      modal.className = "modal";
      modal.innerHTML =
        '<div class="modal-card">' +
        '  <div class="modal-row">' +
        '    <div style="flex:1;font-weight:650">Data</div>' +
        '    <button type="button" id="data-close" class="btn">Close</button>' +
        "  </div>" +
        '  <div id="data-info" class="muted"></div>' +
        '  <div class="modal-row" style="flex-wrap:wrap">' +
        '    <button type="button" id="data-export" class="btn-primary">Export history</button>' +
        '    <label class="btn" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer">' +
        '      Import <input id="data-import" type="file" accept="application/json" style="display:none" />' +
        "    </label>" +
        "  </div>" +
        '  <div id="data-status" class="muted"></div>' +
        '  <div class="card offline-card" style="margin-top:12px">' +
        '    <div class="modal-row" style="align-items:flex-start;gap:12px;flex-wrap:wrap">' +
        '      <div style="flex:1;min-width:220px">' +
        '        <div style="font-weight:650;margin-bottom:4px">Offline</div>' +
        '        <div id="offline-status" class="muted"></div>' +
        '        <div id="offline-progress" class="muted" style="margin-top:6px"></div>' +
        "      </div>" +
        '      <div style="display:flex;flex-direction:column;gap:10px;min-width:220px">' +
        '        <label class="toggle"><input id="offline-auto" type="checkbox" /> Auto-download queued</label>' +
        '        <label class="toggle"><input id="offline-wifi" type="checkbox" /> Wi‑Fi only</label>' +
        '        <label class="toggle" style="gap:10px;justify-content:space-between">' +
        '          <span>Max cached episodes</span>' +
        '          <input id="offline-max" type="number" min="0" max="200" step="1" style="width:90px" />' +
        "        </label>" +
        '        <div class="modal-row" style="padding:0;gap:8px;flex-wrap:wrap">' +
        '          <button type="button" id="offline-refresh" class="btn btn-sm">Refresh</button>' +
        '          <button type="button" id="offline-run" class="btn btn-sm">Download now</button>' +
        '          <button type="button" id="offline-persist" class="btn btn-sm">Keep offline</button>' +
        "        </div>" +
        "      </div>" +
        "    </div>" +
        "  </div>" +
        "</div>";
      document.body.appendChild(modal);
      $("#data-close", modal).addEventListener("click", closeData);
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeData();
      });
    }

    modal.classList.add("open");
    setText("#data-status", "");
    setText("#offline-progress", "");

    renderDataInfo();

    var s = readOfflineSettings();
    var auto = $("#offline-auto", modal);
    var wifi = $("#offline-wifi", modal);
    var max = $("#offline-max", modal);
    if (auto) auto.checked = Boolean(s.auto);
    if (wifi) wifi.checked = Boolean(s.wifiOnly);
    if (max) max.value = String(s.maxEpisodes);

    log("open", computeDataInfo());
    refreshOfflineStatus();
  }

  function closeData() {
    var modal = $("#data-modal");
    if (modal) modal.classList.remove("open");
  }

  function collectExport() {
    var out = {
      version: 1,
      exported_at: new Date().toISOString(),
      history: loadHistory(),
      queue: loadQueue(),
      progress: {},
      speeds: {},
      settings: {
        speed: Number(lsGet(LS_PREFIX + "speed") || "1") || 1,
      },
    };

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(LS_PREFIX + "p:")) {
          var id = k.slice((LS_PREFIX + "p:").length);
          var p = readProgress(id);
          if (!p) continue;
          if (p.c || p.p > 0) out.progress[id] = p;
        }
        if (k.startsWith(LS_PREFIX + "speed:feed:")) {
          var slug = k.slice((LS_PREFIX + "speed:feed:").length);
          var v = Number(lsGet(k) || "") || 0;
          if (v) out.speeds[slug] = v;
        }
      }
    } catch (_e) {}

    return out;
  }

  function downloadJson(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 500);
  }

  function mergeHistory(existing, incoming) {
    var map = new Map();
    (existing || []).forEach(function (it) {
      if (it && it.id) map.set(it.id, it);
    });
    (incoming || []).forEach(function (it) {
      if (!it || !it.id) return;
      var prev = map.get(it.id);
      if (!prev) {
        map.set(it.id, it);
        return;
      }
      var pu = Number(prev.u) || 0;
      var iu = Number(it.u) || 0;
      map.set(it.id, iu >= pu ? it : prev);
    });
    var arr = Array.from(map.values());
    arr.sort(function (a, b) {
      return (Number(b.u) || 0) - (Number(a.u) || 0);
    });
    return arr.slice(0, 200);
  }

  function mergeQueue(existing, incoming) {
    var seen = new Set();
    var out = [];
    (existing || []).forEach(function (it) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    });
    (incoming || []).forEach(function (it) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    });
    return out.slice(0, 200);
  }

  function applyImport(obj) {
    if (!obj || typeof obj !== "object") throw new Error("Invalid file");
    if (Number(obj.version) !== 1) throw new Error("Unsupported version");

    saveHistory(mergeHistory(loadHistory(), obj.history || []));
    saveQueue(mergeQueue(loadQueue(), obj.queue || []));

    var progress = obj.progress || {};
    Object.keys(progress).forEach(function (id) {
      var incoming = progress[id];
      if (!incoming || typeof incoming !== "object") return;
      var prev = readProgress(id);
      var pu = prev ? Number(prev.u) || 0 : 0;
      var iu = Number(incoming.u) || 0;
      if (!prev || iu >= pu) writeProgressObj(id, incoming);
    });

    var speeds = obj.speeds || {};
    Object.keys(speeds).forEach(function (slug) {
      var v = Number(speeds[slug]) || 0;
      if (v) localStorage.setItem(LS_PREFIX + "speed:feed:" + slug, String(v));
    });
    if (obj.settings && obj.settings.speed) {
      var s = Number(obj.settings.speed) || 0;
      if (s) localStorage.setItem(LS_PREFIX + "speed", String(s));
    }

    refreshAllProgress();
    renderHomePanels();
    refreshQueueIndicators();
  }

  function initDataPanelClicks() {
    $all("[data-open-data]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openData();
      });
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var exportBtn = t.closest("#data-export");
      if (exportBtn) {
        e.preventDefault();
        try {
          var payload = collectExport();
          var d = new Date();
          var y = String(d.getFullYear());
          var m = String(d.getMonth() + 1).padStart(2, "0");
          var day = String(d.getDate()).padStart(2, "0");
          downloadJson("podcast-history-" + y + m + day + ".json", payload);
          setText("#data-status", "Exported.");
          log("export", { history: (payload.history || []).length, queue: (payload.queue || []).length });
        } catch (err) {
          warn("export failed", err);
          setText("#data-status", String(err || "Export failed"));
        }
        return;
      }

      var refreshBtn = t.closest("#offline-refresh");
      if (refreshBtn) {
        e.preventDefault();
        log("offline refresh");
        setText("#offline-progress", "");
        refreshOfflineStatus().catch(function (err) {
          warn("offline refresh failed", err);
        });
        return;
      }

      var runBtn = t.closest("#offline-run");
      if (runBtn) {
        e.preventDefault();
        runBtn.disabled = true;
        setText("#offline-progress", "Starting…");
        setText("#data-status", "");
        log("offline download now: start");
        maybeAutoCacheQueue({
          force: true,
          onProgress: function (p) {
            if (!p) return;
            if (p.stage === "start") {
              setText("#offline-progress", "Downloading… 0 / " + String(p.total || 0));
              return;
            }
            if (p.stage === "item") {
              var msg =
                "Downloading… " +
                String(p.done || 0) +
                " / " +
                String(p.total || 0) +
                (p.status ? " (" + p.status + ")" : "");
              setText("#offline-progress", msg);
              return;
            }
            if (p.stage === "done") {
              setText(
                "#offline-progress",
                "Done. Stored: " +
                  String(p.stored || 0) +
                  " · Cached: " +
                  String(p.hit || 0) +
                  " · Failed: " +
                  String(p.fail || 0)
              );
              return;
            }
          },
          onLog: function (msg, extra) {
            log("offline", msg, extra || "");
          },
        })
          .then(function () {
            log("offline download now: done");
            refreshOfflineStatus();
          })
          .catch(function (err) {
            warn("offline download now: failed", err);
            setText("#data-status", String(err && err.message ? err.message : err || "Download failed"));
          })
          .finally(function () {
            runBtn.disabled = false;
          });
        return;
      }

      var persistBtn = t.closest("#offline-persist");
      if (persistBtn) {
        e.preventDefault();
        log("offline persist request");
        if (!navigator.storage || !navigator.storage.persist) {
          setText("#data-status", "Persistent storage API not available in this browser.");
          return;
        }
        persistBtn.disabled = true;
        navigator.storage
          .persist()
          .then(function (ok) {
            setText("#data-status", ok ? "Persistent storage granted." : "Persistent storage not granted.");
            log("offline persist result", ok);
          })
          .catch(function (err) {
            warn("offline persist failed", err);
            setText("#data-status", "Persistent storage request failed.");
          })
          .finally(function () {
            persistBtn.disabled = false;
            refreshOfflineStatus();
          });
        return;
      }
    });

    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || t.id !== "data-import") return;
      var file = t.files && t.files[0];
      if (!file) return;
      setText("#data-status", "Importing…");
      log("import: start", { name: file.name, size: file.size });
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(String(reader.result || ""));
          applyImport(obj);
          setText("#data-status", "Imported.");
          log("import: done");
          renderDataInfo();
        } catch (err) {
          warn("import failed", err);
          setText("#data-status", String(err || "Import failed"));
        } finally {
          t.value = "";
        }
      };
      reader.readAsText(file);
    });

    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id !== "offline-auto" && t.id !== "offline-wifi" && t.id !== "offline-max") return;
      var modal = $("#data-modal");
      if (!modal || !modal.classList.contains("open")) return;

      var auto = $("#offline-auto", modal);
      var wifi = $("#offline-wifi", modal);
      var max = $("#offline-max", modal);
      writeOfflineSettings({
        auto: auto ? Boolean(auto.checked) : false,
        wifiOnly: wifi ? Boolean(wifi.checked) : false,
        maxEpisodes: max ? Number(max.value) : 0,
      });
      log("offline settings changed", readOfflineSettings());
      refreshOfflineStatus();
    });
  }

  initDataPanelClicks();
}
