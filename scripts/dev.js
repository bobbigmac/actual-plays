#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DOCKER_DB = {
  user: "postgres",
  password: "postgres",
  host: "127.0.0.1",
  port: 5432,
  db: "actualplay"
};

function buildDbUrl({ user, password, host, port, db }) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}?schema=public`;
}

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

function getPublishedPort() {
  const res = capture("docker", ["compose", "port", "db", "5432"]);
  if (res.code !== 0) return null;
  const line = (res.out || "").trim().split("\n")[0]?.trim();
  if (!line) return null;

  if (line.startsWith("[")) {
    const idx = line.lastIndexOf("]:");
    if (idx === -1) return null;
    const portStr = line.slice(idx + 2);
    const p = parseInt(portStr, 10);
    return Number.isFinite(p) ? p : null;
  }

  const idx = line.lastIndexOf(":");
  if (idx === -1) return null;
  const portStr = line.slice(idx + 1);
  const p = parseInt(portStr, 10);
  return Number.isFinite(p) ? p : null;
}

function enforceContainerPassword(env) {
  // Reset password inside the container (local socket auth), so the project always uses known creds.
  return run(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "sh",
      "-lc",
      `psql -U ${DEFAULT_DOCKER_DB.user} -d postgres -c "ALTER USER ${DEFAULT_DOCKER_DB.user} WITH PASSWORD '${DEFAULT_DOCKER_DB.password}';"`
    ],
    env
  );
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

  const upCode = run("docker", ["compose", "up", "-d", "--force-recreate", "db"], env);
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

  const dbReady = ensureDb(env);

  if (dbReady) {
    const port = getPublishedPort();
    if (!port) {
      console.log("Docker Postgres started, but its published host port could not be determined.");
      console.log("Run: docker compose port db 5432");
      process.exit(1);
    }

    env.DATABASE_URL = buildDbUrl({ ...DEFAULT_DOCKER_DB, port });
    console.log(`Using docker Postgres on ${DEFAULT_DOCKER_DB.host}:${port}`);
  } else {
    console.log("");
    console.log("Docker Postgres did not start; dev will run without a DB.");
    console.log("Set DATABASE_URL manually if you want to use a remote DB in dev.");
  }

  // Prisma client must exist even for the "no DB" empty-state pages to compile.
  if (run("npx", ["prisma", "generate"], env) !== 0) process.exit(1);

  if (dbReady) {
    // Ensure the container's persisted data uses the expected password (volumes keep old credentials).
    enforceContainerPassword(env);

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
