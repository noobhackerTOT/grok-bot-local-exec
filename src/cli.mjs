#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { patchMainCjs } from "./patch-f4.mjs";

const require = createRequire(import.meta.url);
const asar = require("asar");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const grokbotDir = path.join(os.homedir(), ".grokbot");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function findInstall() {
  const env = process.env.GROK_BOT_HOME;
  const cands = [
    env,
    "D:\\grok\\Grok Bot",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Grok Bot"),
    path.join(process.env.LOCALAPPDATA || "", "Grok Bot"),
  ].filter(Boolean);
  for (const dir of cands) {
    const exe = path.join(dir, "Grok Bot.exe");
    const asarPath = path.join(dir, "resources", "app.asar");
    if (exists(exe) && exists(asarPath)) return { dir, exe, asarPath };
  }
  die(
    "找不到 Grok Bot。设置 GROK_BOT_HOME 为安装目录，或把应用装到 D:\\grok\\Grok Bot。",
  );
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function stopApp() {
  if (process.platform !== "win32") return;
  spawnSync("taskkill", ["/IM", "Grok Bot.exe", "/F"], { stdio: "ignore" });
}

function startApp(exe) {
  if (process.platform !== "win32") return;
  spawnSync("cmd", ["/c", "start", "", exe], { stdio: "ignore", windowsHide: true });
}

function copyIfMissing(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!exists(dest)) fs.copyFileSync(src, dest);
}

function writeUserConfig() {
  fs.mkdirSync(grokbotDir, { recursive: true });
  copyIfMissing(
    path.join(root, "config", "local-exec-roots.example.json"),
    path.join(grokbotDir, "local-exec-roots.json"),
  );
  copyIfMissing(
    path.join(root, "config", "local-mcp.example.json"),
    path.join(grokbotDir, "local-mcp.json"),
  );
}

async function apply() {
  const inst = findInstall();
  const work = path.join(root, ".work");
  const extractDir = path.join(work, "extract");
  const packed = path.join(work, "app.asar.new");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  console.log("install", inst.dir);
  stopApp();

  const tag = stamp();
  const bakAsar = path.join(inst.dir, "resources", `app.asar.bak-${tag}`);
  const bakExe = path.join(inst.dir, `Grok Bot.exe.bak-${tag}`);
  fs.copyFileSync(inst.asarPath, bakAsar);
  fs.copyFileSync(inst.exe, bakExe);
  console.log("backup", bakAsar);
  console.log("backup", bakExe);

  asar.extractAll(inst.asarPath, extractDir);

  const daemon = path.join(extractDir, "dist", "local-exec-daemon");
  if (!exists(daemon)) die("asar 里没有 dist/local-exec-daemon");

  fs.copyFileSync(
    path.join(root, "src", "local-mcp-stdio.cjs"),
    path.join(daemon, "local-mcp-stdio.cjs"),
  );

  const entryPath = path.join(daemon, "entry.cjs");
  const entry = fs.readFileSync(entryPath, "utf8");
  if (!entry.includes("local-mcp-stdio.cjs")) {
    fs.writeFileSync(
      entryPath,
      '"use strict";\nrequire("./local-mcp-stdio.cjs").install();\nrequire("./main.cjs");\n',
    );
  }

  const mainPath = path.join(daemon, "main.cjs");
  const main = fs.readFileSync(mainPath, "utf8");
  const patched = patchMainCjs(main);
  if (patched.status === "missing") {
    die(
      "main.cjs 里找不到 f4 路径检查锚点。Grok Bot 版本可能已变，需要更新 src/patch-f4.mjs。",
    );
  }
  fs.writeFileSync(mainPath, patched.text);
  console.log("f4", patched.status);

  asar.createPackageWithOptions(extractDir, packed, {
    unpack: "*.node",
  });

  await flipFuses(inst.exe, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  });
  console.log("fuse EnableEmbeddedAsarIntegrityValidation=off");

  fs.copyFileSync(packed, inst.asarPath);
  writeUserConfig();
  console.log("wrote", path.join(grokbotDir, "local-exec-roots.json"));
  console.log("wrote", path.join(grokbotDir, "local-mcp.json"));

  startApp(inst.exe);
  console.log("done. 看 ~/.grokbot/local-mcp.log 应有 install extraRoots=");
}

function restore() {
  const inst = findInstall();
  const resources = path.join(inst.dir, "resources");
  const baks = fs
    .readdirSync(resources)
    .filter((n) => n.startsWith("app.asar.bak-"))
    .sort();
  const exeBaks = fs
    .readdirSync(inst.dir)
    .filter((n) => n.startsWith("Grok Bot.exe.bak-"))
    .sort();
  if (!baks.length) die("没有 asar 备份");
  stopApp();
  const asarBak = path.join(resources, baks.at(-1));
  fs.copyFileSync(asarBak, inst.asarPath);
  console.log("restored asar from", asarBak);
  if (exeBaks.length) {
    const exeBak = path.join(inst.dir, exeBaks.at(-1));
    fs.copyFileSync(exeBak, inst.exe);
    console.log("restored exe from", exeBak);
  }
  startApp(inst.exe);
}

function status() {
  const inst = findInstall();
  const log = path.join(grokbotDir, "local-mcp.log");
  console.log("exe", inst.exe, exists(inst.exe));
  console.log("asar", inst.asarPath, fs.statSync(inst.asarPath).size);
  console.log("roots", path.join(grokbotDir, "local-exec-roots.json"), exists(path.join(grokbotDir, "local-exec-roots.json")));
  console.log("mcp  ", path.join(grokbotDir, "local-mcp.json"), exists(path.join(grokbotDir, "local-mcp.json")));
  if (exists(log)) {
    const lines = fs.readFileSync(log, "utf8").trim().split(/\r?\n/);
    console.log("log last:", lines.at(-1));
  } else {
    console.log("log missing");
  }
}

const cmd = process.argv[2] || "status";
if (cmd === "apply") await apply();
else if (cmd === "restore") restore();
else if (cmd === "status") status();
else die("用法: node src/cli.mjs apply|restore|status");
