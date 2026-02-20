import { $ } from "./dom.js";
import { getBasePath } from "./env.js";

var _instance = null;
var _cytoscapePromise = null;

function _isGraphPage() {
  return Boolean(document.querySelector("[data-graph-page]"));
}

function _readGraphData() {
  var el = $("#graph-data");
  if (!el) return null;
  try {
    return JSON.parse(String(el.textContent || "").trim() || "{}");
  } catch (e) {
    console.warn("[graph] Failed to parse graph data", e);
    return null;
  }
}

function _loadScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = function () {
      resolve();
    };
    s.onerror = function () {
      reject(new Error("Failed to load " + src));
    };
    document.head.appendChild(s);
  });
}

function _loadCytoscape() {
  if (window.cytoscape) return Promise.resolve(window.cytoscape);
  if (_cytoscapePromise) return _cytoscapePromise;
  var base = String(getBasePath() || "/");
  if (!base.endsWith("/")) base += "/";
  var src = base + "assets/vendor/cytoscape.min.js";
  _cytoscapePromise = _loadScript(src)
    .then(function () {
      if (!window.cytoscape) throw new Error("cytoscape did not register");
      return window.cytoscape;
    })
    .catch(function (e) {
      _cytoscapePromise = null;
      throw e;
    });
  return _cytoscapePromise;
}

function _clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function _seeded01(s) {
  s = String(s || "");
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 1000000) / 1000000;
}

function _buildGraphModel(data) {
  data = data || {};
  var rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  var rawEdges = Array.isArray(data.edges) ? data.edges : [];

  function estNode(label, kind, deg) {
    label = String(label || "");
    var isPod = kind === "p";
    var maxW = isPod ? 220 : 180;
    var minW = isPod ? 120 : 104;
    var maxLines = 2;
    var fs = isPod ? 13 : 11;
    var ll0 = label.length;
    if (ll0 > 46) fs -= 1;
    if (ll0 > 70) fs -= 1;
    fs = _clamp(fs, isPod ? 10 : 9, isPod ? 14 : 12);
    var charW = fs * 0.62;
    var padX = 26;
    var padY = 18;
    var rawW = label.length * charW + padX;
    var w = _clamp(rawW, minW, maxW);
    var charsPerLine = Math.max(12, Math.floor((w - padX) / charW));
    var maxChars = Math.max(12, charsPerLine * maxLines);
    if (label.length > maxChars) {
      label = label.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
    }
    var ll = label.length;
    var lines = Math.ceil(ll / charsPerLine);
    lines = _clamp(lines, 1, maxLines);
    var lineH = fs + 4;
    var h = padY + lines * lineH;
    var tw = Math.max(60, Math.floor(w - padX));
    return { label: label, ll: ll, fs: fs, w: w, h: h, tw: tw, deg: deg };
  }

  var nodes = rawNodes.map(function (n) {
    return {
      id: String(n.id),
      t: n.t === "p" ? "p" : "s",
      l: String(n.l || n.id || ""),
      h: String(n.h || ""),
      sup: Boolean(n.sup),
      x: 0,
      y: 0,
    };
  });

  var nodeById = {};
  for (var i = 0; i < nodes.length; i++) nodeById[nodes[i].id] = nodes[i];

  var edges = [];
  for (var e = 0; e < rawEdges.length; e++) {
    var row = rawEdges[e];
    if (!Array.isArray(row) || row.length < 3) continue;
    var a = String(row[0]);
    var b = String(row[1]);
    var w = Number(row[2]) || 1;
    var own = row[3] ? 1 : 0;
    if (!nodeById[a] || !nodeById[b]) continue;
    var podId = a.startsWith("p:") ? a : b.startsWith("p:") ? b : null;
    var spId = a.startsWith("s:") ? a : b.startsWith("s:") ? b : null;
    edges.push({ a: a, b: b, podId: podId, spId: spId, w: w, own: own });
  }

  var degreeW = {};
  for (var d = 0; d < edges.length; d++) {
    var ed = edges[d];
    var ww = Number(ed.w) || 1;
    degreeW[ed.a] = (degreeW[ed.a] || 0) + ww;
    degreeW[ed.b] = (degreeW[ed.b] || 0) + ww;
  }

  for (var n2 = 0; n2 < nodes.length; n2++) {
    var nd = nodes[n2];
    var full = String(nd.l || "");
    full = full.replace(/\s+/g, " ").trim();
    nd.l_full = full;
    var dims = estNode(full, nd.t, Number(degreeW[nd.id] || 0));
    nd.l = dims.label;
    nd.ll = dims.ll;
    nd.fs = dims.fs;
    nd.w = dims.w;
    nd.h2 = dims.h;
    nd.tw = dims.tw;
    nd.deg = dims.deg;
  }

  return { nodes: nodes, edges: edges, nodeById: nodeById, degreeW: degreeW };
}

function _computeLayout(model) {
  var nodes = model.nodes;
  var edges = model.edges;
  var degreeW = model.degreeW || {};
  var nodeById = model.nodeById || {};

  var pods = nodes.filter(function (n) {
    return n.t === "p";
  });
  pods.sort(function (a, b) {
    return (degreeW[b.id] || 0) - (degreeW[a.id] || 0);
  });

  var golden = Math.PI * (3 - Math.sqrt(5));
  for (var i = 0; i < pods.length; i++) {
    var p = pods[i];
    var deg = Number(degreeW[p.id] || 0);
    var base = 38 * Math.sqrt(i + 1);
    var pull = 1 / Math.pow(deg + 1, 0.11);
    var r = (120 + base) * (0.75 + 0.25 * pull);
    var a = i * golden + _seeded01(p.id) * 0.8;
    p.x = Math.cos(a) * r;
    p.y = Math.sin(a) * r;
  }

  var topBySpeaker = {};
  for (var j = 0; j < edges.length; j++) {
    var ed = edges[j];
    if (!ed.podId || !ed.spId) continue;
    var list = topBySpeaker[ed.spId] || (topBySpeaker[ed.spId] = []);
    list.push({ podId: ed.podId, w: Number(ed.w) || 1 });
  }

  var sps = nodes.filter(function (n) {
    return n.t === "s";
  });
  for (var k = 0; k < sps.length; k++) {
    var s = sps[k];
    var list2 = topBySpeaker[s.id] || [];
    list2.sort(function (x, y) {
      return y.w - x.w;
    });
    list2 = list2.slice(0, 3);
    var sumW = 0;
    var x = 0;
    var y = 0;
    for (var m = 0; m < list2.length; m++) {
      var pod = nodeById[list2[m].podId];
      if (!pod) continue;
      var ww = list2[m].w;
      sumW += ww;
      x += pod.x * ww;
      y += pod.y * ww;
    }
    if (sumW > 0) {
      x /= sumW;
      y /= sumW;
    } else {
      x = 0;
      y = 0;
    }
    var a2 = _seeded01(s.id) * Math.PI * 2;
    var jitter = 60 + 280 / Math.pow(sumW + 1, 0.42);
    s.x = x + Math.cos(a2) * jitter;
    s.y = y + Math.sin(a2) * jitter;
  }

  // Deterministic overlap resolution for the label-rect nodes.
  // A few passes is enough to prevent the "dense fog" of overlapping labels.
  function bbox(n) {
    var w = Number(n.w || 140);
    var h = Number(n.h2 || 40);
    return { x0: n.x - w / 2, y0: n.y - h / 2, x1: n.x + w / 2, y1: n.y + h / 2 };
  }

  function overlaps(a, b) {
    return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
  }

  var order = nodes.slice().sort(function (a, b) {
    // Place podcasts first, then by degree.
    var ta = a.t === "p" ? 0 : 1;
    var tb = b.t === "p" ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return (degreeW[b.id] || 0) - (degreeW[a.id] || 0);
  });

  var cell = 240;
  function key(x, y) {
    return Math.floor(x / cell) + "," + Math.floor(y / cell);
  }

  for (var pass = 0; pass < 3; pass++) {
    var grid = {};
    for (var i2 = 0; i2 < order.length; i2++) {
      var n2 = order[i2];
      var tries = 0;
      while (tries < 10) {
        var bx = bbox(n2);
        var cx = Math.floor(n2.x / cell);
        var cy = Math.floor(n2.y / cell);
        var hit = null;
        for (var gx = cx - 1; gx <= cx + 1 && !hit; gx++) {
          for (var gy = cy - 1; gy <= cy + 1 && !hit; gy++) {
            var bucket = grid[gx + "," + gy];
            if (!bucket) continue;
            for (var bi = 0; bi < bucket.length; bi++) {
              var other = bucket[bi];
              if (other === n2) continue;
              var bo = bbox(other);
              if (overlaps(bx, bo)) hit = other;
            }
          }
        }
        if (!hit) break;
        var ang = _seeded01(n2.id + ":" + pass + ":" + tries) * Math.PI * 2;
        var step = 26 + pass * 10;
        n2.x += Math.cos(ang) * step;
        n2.y += Math.sin(ang) * step;
        tries++;
      }
      var k2 = key(n2.x, n2.y);
      (grid[k2] || (grid[k2] = [])).push(n2);
    }
  }
}

function _makeCyElements(model) {
  var els = [];
  for (var i = 0; i < model.nodes.length; i++) {
    var n = model.nodes[i];
    els.push({
      group: "nodes",
      data: {
        id: n.id,
        label: n.l,
        full: n.l_full || n.l,
        ll: n.ll || Math.min(80, String(n.l || "").length || 0),
        deg: Number(n.deg || (model.degreeW && model.degreeW[n.id] ? model.degreeW[n.id] : 0)),
        fs: Number(n.fs || (n.t === "p" ? 12 : 10)),
        w: Number(n.w || (n.t === "p" ? 150 : 120)),
        h: Number(n.h2 || (n.t === "p" ? 44 : 38)),
        tw: Number(n.tw || (n.t === "p" ? 210 : 170)),
        href: n.h,
        kind: n.t,
        supplemental: n.sup ? 1 : 0,
      },
      position: { x: n.x, y: n.y },
      classes:
        (n.t === "p" ? "podcast" : "speaker") + (n.sup ? " supplemental" : ""),
    });
  }
  for (var e = 0; e < model.edges.length; e++) {
    var ed = model.edges[e];
    els.push({
      group: "edges",
      data: {
        id: "e:" + e,
        source: ed.a,
        target: ed.b,
        weight: Number(ed.w) || 1,
        own: ed.own ? 1 : 0,
        podId: ed.podId || "",
      },
    });
  }
  return els;
}

function _initCy(opts) {
  var cytoscape = opts.cytoscape;
  var container = opts.container;
  var model = opts.model;

  var cy = cytoscape({
    container: container,
    elements: _makeCyElements(model),
    layout: { name: "preset" },
    userZoomingEnabled: true,
    userPanningEnabled: true,
    autoungrabify: true,
    wheelSensitivity: 0.17,
    textureOnViewport: true,
    pixelRatio: 1,
    style: [
      {
        selector: "node",
        style: {
          shape: "roundrectangle",
          label: "data(label)",
          "text-wrap": "wrap",
          "text-max-width": "data(tw)",
          "text-valign": "center",
          "text-halign": "center",
          width: "data(w)",
          height: "data(h)",
          "background-opacity": 0.92,
          "border-width": 1.25,
          "border-color": "rgba(255,255,255,0.12)",
          color: "rgba(232,232,234,0.92)",
          "text-outline-width": 2,
          "text-outline-color": "rgba(0,0,0,0.55)",
          "font-family":
            "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
          "font-size": "data(fs)",
          "min-zoomed-font-size": 9,
        },
      },
      {
        selector: "node.podcast",
        style: {
          "background-color": "rgba(20,28,38,0.94)",
          "border-color": "rgba(155,209,255,0.55)",
          "min-zoomed-font-size": 10,
        },
      },
      {
        selector: "node.speaker",
        style: {
          "background-color": "rgba(22,22,24,0.92)",
          "border-color": "rgba(255,184,120,0.42)",
          "min-zoomed-font-size": 8,
          color: "rgba(232,232,234,0.88)",
        },
      },
      {
        selector: "node.supplemental",
        style: {
          "border-color": "rgba(130,190,255,0.42)",
        },
      },
      {
        selector: "edge",
        style: {
          width: "mapData(weight, 1, 40, 0.4, 3.0)",
          "curve-style": "haystack",
          "line-color": "rgba(155,209,255,0.18)",
          opacity: 0.7,
        },
      },
      {
        selector: "edge[own = 1]",
        style: {
          "line-color": "rgba(255,184,120,0.18)",
        },
      },
      {
        selector: ".is-dim",
        style: { opacity: 0.12 },
      },
      {
        selector: ".is-hidden",
        style: { display: "none" },
      },
    ],
  });

  cy.on("tap", "node", function (evt) {
    var n = evt && evt.target ? evt.target : null;
    if (!n) return;
    var href = String(n.data("href") || "");
    if (href) window.location.href = href;
  });

  cy.on("mouseover", "node", function (evt) {
    var n = evt && evt.target ? evt.target : null;
    if (!n) return;
    if (opts.onHover) opts.onHover(String(n.data("full") || n.data("label") || ""));
  });
  cy.on("mouseout", "node", function () {
    if (opts.onHover) opts.onHover("");
  });

  return cy;
}

function _applyFilters(opts) {
  var cy = opts.cy;
  var model = opts.model;
  var includeSupp = Boolean(opts.includeSupp);
  var includeOwn = Boolean(opts.includeOwn);
  var minW = Number(opts.minW) || 1;
  var q = String(opts.q || "").trim().toLowerCase();

  var visibleNodes = new Set();
  for (var i = 0; i < model.edges.length; i++) {
    var e = model.edges[i];
    var w = Number(e.w) || 1;
    var okW = w >= minW;
    var okOwn = includeOwn ? true : !Boolean(e.own);
    var okSupp = true;
    if (!includeSupp && e.podId) {
      var pod = model.nodeById[e.podId];
      okSupp = pod ? !pod.sup : true;
    }
    var show = okW && okOwn && okSupp;
    var edgeEl = cy.getElementById("e:" + i);
    if (edgeEl) edgeEl.toggleClass("is-hidden", !show);
    if (show) {
      visibleNodes.add(e.a);
      visibleNodes.add(e.b);
    }
  }

  for (var j = 0; j < model.nodes.length; j++) {
    var n = model.nodes[j];
    var el = cy.getElementById(n.id);
    if (!el) continue;
    var connected = visibleNodes.has(n.id);
    el.toggleClass("is-hidden", !connected);
    if (q) {
      var match = String(n.l || "").toLowerCase().indexOf(q) !== -1;
      el.toggleClass("is-dim", connected && !match);
    } else {
      el.removeClass("is-dim");
    }
  }

  var nodeCount = 0;
  var edgeCount = 0;
  cy.nodes().forEach(function (n) {
    if (!n.hasClass("is-hidden")) nodeCount++;
  });
  cy.edges().forEach(function (e) {
    if (!e.hasClass("is-hidden")) edgeCount++;
  });
  if (opts.statsEl) opts.statsEl.textContent = nodeCount + " nodes · " + edgeCount + " edges";
}

export function initGraph() {
  if (_instance && _instance.destroy && !_isGraphPage()) {
    _instance.destroy();
    _instance = null;
    return;
  }
  if (!_isGraphPage()) return;

  var container = document.querySelector("[data-graph-vis]");
  if (!container) return;

  if (_instance && _instance.loading) return;

  var data = _readGraphData();
  if (!data) return;

  var filterEl = document.querySelector("[data-graph-filter]");
  var minWeightEl = document.querySelector("[data-graph-minweight]");
  var minWeightReadoutEl = document.querySelector("[data-graph-minweight-readout]");
  var resetBtn = document.querySelector("[data-graph-reset]");
  var toggleSuppEl = document.querySelector('[data-graph-toggle="supp"]');
  var toggleOwnEl = document.querySelector('[data-graph-toggle="own"]');
  var statsEl = document.querySelector("[data-graph-stats]");

  var includeSupp = false;
  var includeOwn = false;
  var minW = 2;
  var q = "";

  function readControls() {
    includeSupp = Boolean(toggleSuppEl && toggleSuppEl.querySelector("input") && toggleSuppEl.querySelector("input").checked);
    includeOwn = Boolean(toggleOwnEl && toggleOwnEl.querySelector("input") && toggleOwnEl.querySelector("input").checked);
    minW = _clamp(Number(minWeightEl && minWeightEl.value) || 1, 1, 50);
    q = String(filterEl && filterEl.value ? filterEl.value : "");
    if (minWeightReadoutEl) minWeightReadoutEl.textContent = String(minW);
  }

  function apply() {
    if (!_instance || !_instance.cy) return;
    readControls();
    _applyFilters({
      cy: _instance.cy,
      model: _instance.model,
      includeSupp: includeSupp,
      includeOwn: includeOwn,
      minW: minW,
      q: q,
      statsEl: statsEl,
    });
  }

  // Tear down any previous instance (hot nav).
  if (_instance && _instance.destroy) _instance.destroy();
  _instance = { cy: null, model: null, destroy: null, loading: true };

  _loadCytoscape()
    .then(function (cytoscape) {
      if (!_isGraphPage()) return;
      var model = _buildGraphModel(data);
      _computeLayout(model);
      var hoverNote = "";
      function onHover(txt) {
        hoverNote = String(txt || "");
        if (!statsEl) return;
        if (hoverNote) statsEl.textContent = hoverNote;
        else apply();
      }

      var cy = _initCy({
        cytoscape: cytoscape,
        container: container,
        model: model,
        onHover: onHover,
      });

      function destroy() {
        try {
          if (cy) cy.destroy();
        } catch (_e) {}
      }

      _instance = { cy: cy, model: model, destroy: destroy, loading: false };

      // Layout once (no animation). Use COSE to avoid overlaps and preserve strong links.
      try {
        if (statsEl) statsEl.textContent = "Laying out…";
        var layout = cy.layout({
          name: "cose",
          animate: false,
          randomize: false,
          fit: false,
          padding: 40,
          nodeDimensionsIncludeLabels: true,
          avoidOverlap: true,
          avoidOverlapPadding: 10,
          componentSpacing: 70,
          nodeOverlap: 4,
          idealEdgeLength: function (edge) {
            var w0 = Number(edge.data("weight") || 1);
            if (w0 < 1) w0 = 1;
            var cap = Math.min(w0, 90);
            return 240 / Math.pow(cap, 0.33) + 60;
          },
          edgeElasticity: function (edge) {
            var w1 = Number(edge.data("weight") || 1);
            return 30 + Math.min(120, w1 * 2);
          },
          nodeRepulsion: function (node) {
            var deg = Number(node.data("deg") || 0);
            return 8200 + Math.min(14000, deg * 60);
          },
          gravity: 0.4,
          numIter: 900,
          initialTemp: 180,
          coolingFactor: 0.98,
          minTemp: 1.0,
        });
        layout.run();
      } catch (_e) {}

      // Don't fit everything: start with a comfortable zoom.
      try {
        cy.center();
        var w = container && container.clientWidth ? container.clientWidth : 1000;
        cy.zoom(w < 720 ? 0.9 : 1.05);
      } catch (_e) {}

      readControls();
      apply();

      function onAny() {
        apply();
      }

      if (filterEl) filterEl.addEventListener("input", onAny);
      if (minWeightEl) minWeightEl.addEventListener("input", onAny);
      if (toggleSuppEl) toggleSuppEl.addEventListener("change", onAny);
      if (toggleOwnEl) toggleOwnEl.addEventListener("change", onAny);
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          if (!_instance || !_instance.cy) return;
          if (filterEl) filterEl.value = "";
          if (minWeightEl) minWeightEl.value = "2";
          if (toggleSuppEl && toggleSuppEl.querySelector("input")) toggleSuppEl.querySelector("input").checked = false;
          if (toggleOwnEl && toggleOwnEl.querySelector("input")) toggleOwnEl.querySelector("input").checked = false;
          readControls();
          apply();
          try {
            _instance.cy.center();
            var w = container && container.clientWidth ? container.clientWidth : 1000;
            _instance.cy.zoom(w < 720 ? 0.9 : 1.05);
          } catch (_e) {}
        });
      }
    })
    .catch(function (e) {
      console.warn("[graph] Cytoscape failed to load/init", e);
      if (statsEl) statsEl.textContent = "Graph failed to load.";
      if (_instance) _instance.loading = false;
    });
}
