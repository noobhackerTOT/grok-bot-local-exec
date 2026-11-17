"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const GROKBOT_DIR = path.join(os.homedir(), ".grokbot");
const MCP_CFG = path.join(GROKBOT_DIR, "local-mcp.json");
const ROOTS_CFG = path.join(GROKBOT_DIR, "local-exec-roots.json");

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function extraRoots() {
  const cfg = loadJson(ROOTS_CFG, null);
  const list = Array.isArray(cfg) ? cfg : cfg && Array.isArray(cfg.roots) ? cfg.roots : ["D:\\"];
  return list.map((item) => path.resolve(String(item)));
}

function pathAllowed(resolved, raw) {
  const target = path.resolve(resolved || raw || "");
  const roots = [os.homedir(), ...extraRoots()];
  return roots.some((root) => {
    const abs = path.resolve(root);
    const rel = path.relative(abs, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

class StdioMcpClient {
  constructor(name, command, args, env) {
    this.name = name;
    this.command = command;
    this.args = args || [];
    this.env = env || {};
    this.proc = null;
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  start() {
    this.proc = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
      windowsHide: true,
      shell: false,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.on("data", (chunk) => {
      try {
        fs.appendFileSync(
          path.join(GROKBOT_DIR, "local-mcp.log"),
          `[${this.name}:err] ${chunk}`,
        );
      } catch {
        /* ignore */
      }
    });
    this.proc.on("exit", (code) => {
      for (const [, pending] of this.pending) pending.reject(new Error(`${this.name} exited ${code}`));
      this.pending.clear();
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    for (;;) {
      const match = this.buf.match(/Content-Length:\s*(\d+)\r?\n\r?\n/i);
      if (!match) break;
      const len = Number(match[1]);
      const headerEnd = match.index + match[0].length;
      if (this.buf.length < headerEnd + len) break;
      const body = this.buf.slice(headerEnd, headerEnd + len);
      this.buf = this.buf.slice(headerEnd + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      }
    }
  }

  send(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const frame = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(frame);
    });
  }

  notify(method, params) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  }

  async handshake() {
    const result = await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sand-local-mcp", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  toolsList() {
    return this.send("tools/list", {});
  }

  toolsCall(name, args) {
    return this.send("tools/call", { name, arguments: args || {} });
  }
}

function logLine(text) {
  try {
    fs.appendFileSync(path.join(GROKBOT_DIR, "local-mcp.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {
    /* ignore */
  }
}

async function bootMcp() {
  const cfg = loadJson(MCP_CFG, { mcpServers: {} });
  const servers = cfg.mcpServers || cfg.servers || {};
  const clients = [];
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || !spec.command) continue;
    const client = new StdioMcpClient(name, spec.command, spec.args || [], spec.env || {});
    try {
      client.start();
      await client.handshake();
      const listed = await client.toolsList();
      const names = (listed && listed.tools ? listed.tools : []).map((tool) => tool.name);
      logLine(`${name} tools/list ${names.join(",") || "(none)"}`);
      clients.push(client);
    } catch (err) {
      logLine(`${name} failed ${err && err.message ? err.message : err}`);
    }
  }
  globalThis.__sandLocalMcp = clients;
}

function install() {
  globalThis.__sandExtraRootOk = function (resolved, raw) {
    try {
      return pathAllowed(resolved, raw);
    } catch {
      return false;
    }
  };
  logLine(`install extraRoots=${extraRoots().join(";")}`);
  bootMcp().catch((err) => logLine(`boot ${err && err.message ? err.message : err}`));
}

module.exports = { install, pathAllowed, extraRoots, StdioMcpClient };
