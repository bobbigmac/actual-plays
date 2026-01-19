#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  return { code: res.status ?? 0, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function shell(cmd) {
  const res = spawnSync("sh", ["-lc", cmd], { stdio: "pipe", encoding: "utf8" });
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

function userInDockerGroup() {
  const who = run("id", ["-un"]);
  const user = (who.out || "").trim();
  if (!user) return { ok: false, user: null };

  const g = run("getent", ["group", "docker"]);
  if (g.code !== 0) return { ok: false, user };

  return { ok: g.out.includes(user), user };
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
    const membership = userInDockerGroup();
    if (membership.user && membership.ok) {
      console.log("It looks like you're in the 'docker' group, but this shell hasn't refreshed group membership.");
      console.log("Trying to run via 'sg docker' (works without logging out on many systems)...");
      const upViaSg = shell("sg docker -c 'docker compose up -d db'");
      process.stdout.write(upViaSg.out);
      process.stderr.write(upViaSg.err);
      if (upViaSg.code === 0) return;
      console.log("");
    }

    console.log("Fix options (Linux):");
    console.log("- Ensure docker is running: sudo systemctl enable --now docker");
    console.log("- Add user to docker group: sudo usermod -aG docker $USER");
    console.log("- Then log out/in (or run: newgrp docker) and retry");
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
