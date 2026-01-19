#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  return { code: res.status ?? 0, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function hasDocker() {
  const v = run("docker", ["--version"]);
  return v.code === 0;
}

function dockerWorks() {
  const info = run("docker", ["info"]);
  return { ok: info.code === 0, err: info.err };
}

function printNoDocker() {
  console.log("No Docker available.");
  console.log("");
  console.log("Use one of:");
  console.log("- CapRover one-click Postgres app, then set DATABASE_URL for this app");
  console.log("- Managed Postgres (Neon/Supabase/etc), then set DATABASE_URL");
  console.log("- Install Postgres locally, then set DATABASE_URL");
  console.log("");
  console.log("See README.md for the CapRover steps.");
}

function main() {
  if (!hasDocker()) return printNoDocker();

  const { ok, err } = dockerWorks();
  if (!ok) {
    console.log("Docker is installed, but this user cannot access the Docker daemon.");
    if (err.trim()) console.log(err.trim());
    console.log("");
    console.log("Fix options:");
    console.log("- Install/start Docker Desktop (macOS/Windows)");
    console.log("- Linux: ensure docker is running and your user can access /var/run/docker.sock");
    console.log("  e.g. add user to docker group, then log out/in");
    console.log("");
    console.log("Or skip Docker entirely and use CapRover/managed Postgres (recommended).");
    console.log("See README.md for the CapRover steps.");
    process.exitCode = 1;
    return;
  }

  const up = run("docker", ["compose", "up", "-d", "db"]);
  process.stdout.write(up.out);
  process.stderr.write(up.err);
  if (up.code !== 0) process.exitCode = up.code;
}

main();

