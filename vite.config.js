import { defineConfig } from "vite";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch (_e) {
    return false;
  }
}

function normalize(p) {
  return p.split(path.sep).join("/");
}

function devBuilderPlugin() {
  const repoRoot = process.cwd();
  const distRoot = path.join(repoRoot, "dist");
  const assetsSrc = path.join(repoRoot, "site", "assets");
  const pwaSrc = path.join(repoRoot, "site", "pwa", "sw.js");

  let running = false;
  let queued = null;
  let serverRef = null;

  async function buildSite({ alsoUpdateFeeds }) {
    if (running) {
      queued = queued || { alsoUpdateFeeds: false };
      queued.alsoUpdateFeeds = queued.alsoUpdateFeeds || alsoUpdateFeeds;
      return;
    }
    running = true;
    try {
      if (alsoUpdateFeeds) {
        serverRef?.ws?.send({
          type: "custom",
          event: "ap:status",
          data: { stage: "update", status: "start" },
        });
        const t0 = Date.now();
        await run("python3", ["-m", "scripts.update_feeds", "--quiet"], { cwd: repoRoot });
        serverRef?.ws?.send({
          type: "custom",
          event: "ap:status",
          data: { stage: "update", status: "done", ms: Date.now() - t0 },
        });
      } else {
        serverRef?.ws?.send({
          type: "custom",
          event: "ap:status",
          data: { stage: "update", status: "skip" },
        });
      }

      serverRef?.ws?.send({
        type: "custom",
        event: "ap:status",
        data: { stage: "build", status: "start" },
      });
      const t1 = Date.now();
      await run("python3", ["-m", "scripts.build_site", "--base-path", "/"], { cwd: repoRoot });
      serverRef?.ws?.send({
        type: "custom",
        event: "ap:status",
        data: { stage: "build", status: "done", ms: Date.now() - t1 },
      });
    } finally {
      running = false;
      const next = queued;
      queued = null;
      if (next) await buildSite(next);
    }
  }

function copyAsset(file) {
  const rel = normalize(path.relative(assetsSrc, file));
  if (rel.startsWith("..")) return false;
  if (!exists(distRoot)) return false;
  const outFile = path.join(distRoot, "assets", rel);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.copyFileSync(file, outFile);
  return true;
}

  return {
    name: "ap-dev-builder",
    configureServer(server) {
      serverRef = server;
      const watch = [
        "site/assets/**",
        "site/templates/**",
        "site/pwa/**",
        "scripts/**",
        "site.json",
        "feeds.json",
        "feeds.sample.json",
        "cache/**",
        "samples/**",
      ];
      server.watcher.add(watch);

      // Initial build for dev so dist exists.
      buildSite({ alsoUpdateFeeds: false })
        .then(() => server.ws.send({ type: "full-reload" }))
        .catch((e) => {
          server.ws.send({
            type: "custom",
            event: "ap:status",
            data: { stage: "build", status: "error", error: String(e?.message || e || "unknown") },
          });
        });

      server.watcher.on("all", async (event, file) => {
        if (!file) return;
        const f = path.resolve(file);
        const rel = normalize(path.relative(repoRoot, f));
        if (rel.startsWith("dist/")) return;
        if (event !== "add" && event !== "change" && event !== "unlink") return;

        // Fast path: asset file changes only need a copy + reload.
        if (rel.startsWith("site/assets/") && exists(f) && copyAsset(f)) {
          server.ws.send({
            type: "custom",
            event: "ap:status",
            data: { stage: "assets", status: "done", reason: "copied", file: rel },
          });
          server.ws.send({ type: "full-reload" });
          return;
        }

        // Service worker source change: copy by rebuild (it also updates manifest).
        if (normalize(f) === normalize(pwaSrc)) {
          server.ws.send({
            type: "custom",
            event: "ap:status",
            data: { stage: "build", status: "start", reason: "sw", file: rel },
          });
          await buildSite({ alsoUpdateFeeds: false }).catch((e) => {
            server.ws.send({
              type: "custom",
              event: "ap:status",
              data: { stage: "build", status: "error", reason: "sw", error: String(e?.message || e || "unknown") },
            });
          });
          server.ws.send({ type: "full-reload" });
          return;
        }

        const alsoUpdateFeeds = rel === "feeds.json" || rel.startsWith("samples/");
        server.ws.send({
          type: "custom",
          event: "ap:status",
          data: { stage: "build", status: "start", reason: alsoUpdateFeeds ? "update+build" : "build", file: rel },
        });
        await buildSite({ alsoUpdateFeeds }).catch((e) => {
          server.ws.send({
            type: "custom",
            event: "ap:status",
            data: { stage: "build", status: "error", error: String(e?.message || e || "unknown"), file: rel },
          });
        });
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig({
  root: "dist",
  plugins: [devBuilderPlugin()],
  server: {
    port: 8000,
    strictPort: true,
  },
});
