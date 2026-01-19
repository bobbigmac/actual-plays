#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/actualplay?schema=public";

function run(cmd, args, env, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    env,
    ...opts
  });
  return res.status ?? 0;
}

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  return { code: res.status ?? 0, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function dockerAccessible() {
  const info = capture("docker", ["info"]);
  return { ok: info.code === 0, err: info.err.trim() };
}

function ensureDb(env) {
  const { ok, err } = dockerAccessible();
  if (!ok) {
    console.log("");
    console.log("Docker not usable in this shell; skipping local Postgres.");
    if (err) console.log(err);
    console.log("Tip: set DATABASE_URL to a CapRover/managed Postgres to enable data features.");
    return false;
  }

  const upCode = run("docker", ["compose", "up", "-d", "db"], env);
  if (upCode !== 0) return false;

  const waitCode = run(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "sh",
      "-lc",
      "until pg_isready -U postgres -d actualplay; do sleep 1; done"
    ],
    env
  );
  return waitCode === 0;
}

async function main() {
  const env = { ...process.env };

  // Next/Turbopack cache occasionally gets into a bad state ("Failed to compact database ... incompatible version").
  // Clearing just the cache directories avoids needing manual intervention.
  const cachePaths = [path.join(process.cwd(), ".next", "cache"), path.join(process.cwd(), ".next", "dev")];
  for (const p of cachePaths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  if (!env.DATABASE_URL) {
    env.DATABASE_URL = DEFAULT_DATABASE_URL;
    console.log(`DATABASE_URL not set; defaulting to local docker Postgres: ${env.DATABASE_URL}`);
  }

  const dbReady = ensureDb(env);

  // Prisma client must exist even for the "no DB" empty-state pages to compile.
  if (run("npx", ["prisma", "generate"], env) !== 0) process.exit(1);

  if (dbReady) {
    if (run("npx", ["prisma", "migrate", "deploy"], env) !== 0) process.exit(1);
    run("npx", ["prisma", "db", "seed"], env);
  }

  const args = ["next", "dev", ...process.argv.slice(2)];
  const child = spawn("npx", args, { stdio: "inherit", env });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
