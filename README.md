# grok-bot-local-exec

给 **Grok Bot 桌面端** 的 `local-exec-daemon` 打补丁：

1. 放宽 Read / Write 的磁盘根目录（默认增加 `D:\`）
2. 在本机拉起 **stdio MCP** 客户端（`initialize` / `tools/list` / `tools/call`）

Grok Bot 原厂行为：自定义 MCP 的 `command` + `args` 在 Linux box 上执行，本机守护进程里没有 `StdioClientTransport`。文件工具（`read-file` / `write-file` / `list-directory`）权限开关是 `global`，但路径仍被限制在用户目录。本仓库改的是本机守护进程，不是云端模型工具表。

在 Grok Bot 1.2.0（Windows，`app.asar` 内 `dist/local-exec-daemon/main.cjs` 含 `async function f4` 锚点）上验证过：`D:\` 上的 Read 不再报 `outside the allowed local-exec root`。

## 安装

```powershell
git clone <your-fork-url> grok-bot-local-exec
cd grok-bot-local-exec
npm install
npm run apply
```

默认安装路径：`D:\grok\Grok Bot`。其它位置：

```powershell
$env:GROK_BOT_HOME = 'C:\Users\YOU\AppData\Local\Programs\Grok Bot'
npm run apply
```

`apply` 会：停掉 Grok Bot → 备份 `app.asar` 和 `Grok Bot.exe` → 解包 asar → 写入 sidecar、改 `entry.cjs` / `f4` → 重新打包 → 关闭 Electron 的 `EnableEmbeddedAsarIntegrityValidation` → 写用户配置 → 再启动应用。

```powershell
npm run status
npm run restore
```

## 配置

写在 `%USERPROFILE%\.grokbot\`（已有文件不会覆盖）：

`local-exec-roots.json`

```json
["D:\\"]
```

可再加 `"E:\\"` 等。用户目录始终允许。

`local-mcp.json`

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\Notes"]
    }
  }
}
```

空对象 `{}` 不拉子进程。改完重启 Grok Bot。日志：`%USERPROFILE%\.grokbot\local-mcp.log`，应出现 `install extraRoots=D:\`。

## 测试 prompt

发给 Grok Bot（把路径换成你盘上真实存在的文件）：

```
用本机文件工具（Read / list-directory），不要用 Shell，不要 CopyToBox。

1. 列出 D:\Notes\笔记\04-安全专题\
2. 读取 D:\Notes\笔记\04-安全专题\Grok-Bot本地文件操作.md 的前 30 行
3. 把读到的标题原样贴回来

如果报 Path is outside the allowed local-exec root，直接把完整报错贴出来，不要改用 Shell。
```

成功：能读 `D:\` 文件，无根目录报错。  
`list-directory` 可能不在当前会话的工具列表里；对目录用 Read 会得到 `Path is a directory, not a file`，这不代表补丁失败。

## 仓库结构

```text
src/local-mcp-stdio.cjs   本机 stdio MCP + extraRoots
src/patch-f4.mjs          main.cjs 路径检查锚点
src/cli.mjs               apply / restore / status
config/*.example.json     用户配置样例
```

不把官方 `app.asar` 放进 git。

## 限制

- 官方更新会覆盖 asar，并可能重新打开完整性校验，需要再 `npm run apply`。
- 新版本若改了 `f4` 压缩后的函数体，`apply` 会报锚点找不到，改 `src/patch-f4.mjs`。
- 本机 MCP 工具 **不会** 自动出现在云端模型的工具列表；sidecar 负责 spawn 和 JSON-RPC。文件 Read/Write 走放宽后的根目录。
- 关闭 asar 完整性校验是为了让改过的包能启动。

## 还原

```powershell
npm run restore
```

用最近一次 `apply` 留下的 `app.asar.bak-*` 和 `Grok Bot.exe.bak-*`。
