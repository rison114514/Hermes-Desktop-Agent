// Mod → Agent bridge.
//
// The Hermes agent runs as `hermes acp` inside WSL. It owns its own system
// prompt and loads skills from ~/.hermes/skills/<category>/<name>/. It has full
// shell + file access in WSL, but it CANNOT call Electron mod IPC handlers
// (connect / ssh-exec / todo-add live in the desktop process). That mismatch is
// why the old mod `systemPrompt`/skills — which told the agent to call those
// IPC tools — never actually worked.
//
// This bridge closes the gap using the channels the agent really has:
//   1. Desktop writes the live mod data into the skill directories under
//      ~/.hermes/skills/hermes-mods/ (memo/todos.json, ssh-info/ssh-servers.json)
//      so the agent discovers them alongside their SKILL.md files.
//   2. Desktop installs two real SKILL.md files under ~/.hermes/skills/hermes-mods/
//      describing where that data is and how to act on it (for SSH: use the
//      agent's own shell `ssh` with the synced credentials — real execution
//      routing, no RPC needed).
//   3. For todo write-back the agent appends JSONL commands to
//      todo-commands.jsonl; the desktop drains + applies them on the next turn.

import { runWslCommand } from './wsl-paths.js'

export interface ModBridgeData {
  todos: unknown[]
  sshServers: unknown[]
}

const MEMO_SKILL = `---
name: 用户任务备忘录
description: 读取并管理用户在 Hermes 桌面应用中的任务备忘列表（待办、DDL）
---

# 用户任务备忘录

用户在桌面应用侧边栏维护着一个任务备忘列表。完整数据已同步到本机文件：

\`~/.hermes/skills/hermes-mods/memo/todos.json\`

## 读取任务
直接读取该 JSON 文件即可获得全部任务。每个任务字段：
- title 标题
- detail 详情
- urgency 紧急程度 (low/medium/high)
- importance 重要程度 (low/medium/high)
- ddl 截止时间 (ISO 字符串或 null)
- done 是否完成

当用户问“我有哪些待办/备忘/任务”或提到 DDL/截止日期时，读取此文件后回答。

## 修改任务
若用户要求添加/完成/删除任务，向以下文件**追加**一行 JSON（JSONL，每行一个对象）：

\`~/.hermes/mod-bridge/todo-commands.jsonl\`

支持的命令：
- 添加: {"op":"add","title":"…","detail":"","urgency":"medium","importance":"medium","ddl":null}
- 标记完成/取消完成: {"op":"toggle","index":0}
- 删除: {"op":"remove","index":0}
- 清除已完成: {"op":"clear-done"}

index 为 todos.json 中任务的序号（从 0 开始）。桌面应用会在下一轮交互时应用这些命令并刷新列表。
`

const SSH_SKILL = `---
name: 用户的 SSH 服务器
description: 读取用户保存的 SSH 服务器连接信息（含凭据），并通过 shell 直接操作远程服务器
---

# 用户的 SSH 服务器

用户在桌面应用中保存了 SSH 服务器配置。完整信息（含密码 / 密钥路径）已同步到：

\`~/.hermes/skills/hermes-mods/ssh-info/ssh-servers.json\`

每个服务器字段：name, host, port, username, authType (password|key), password, keyPath。

## 连接与执行
你拥有本机 WSL 的完整 shell。要在某台服务器上执行命令，直接用 shell 的 ssh：

- 密钥认证: \`ssh -i <keyPath> -p <port> <username>@<host> "<命令>"\`
- 密码认证: 优先使用密钥。若必须用密码，可用
  \`sshpass -p '<password>' ssh -p <port> <username>@<host> "<命令>"\`
  （若未安装 sshpass，提示用户或改用密钥）。

首次连接某主机若遇 host key 确认，可加 \`-o StrictHostKeyChecking=accept-new\`。

当用户说“连接我的服务器 / 查看服务器 / 部署”时，从 ssh-servers.json 读取对应主机信息后直接用 shell ssh 操作，不要再询问已保存过的连接信息。
`

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

// One base64 payload → one file. base64 is single-quote safe; the redirect
// target uses $HOME inside double quotes so the tilde actually expands.
function writeFileCmd(relPath: string, content: string): string {
  return `printf %s '${b64(content)}' | base64 -d > "$HOME/${relPath}"`
}

// Push current mod data + skill docs into WSL in a single wsl.exe invocation.
// Also removes stale data files from the old ~/.hermes/mod-bridge/ location
// (moved to skill dirs in a previous version) so the agent never reads outdated
// copies.  rm -f is idempotent — no error when the files don't exist.
export async function syncModBridge(data: ModBridgeData): Promise<void> {
  const cmd = [
    'mkdir -p "$HOME/.hermes/mod-bridge" "$HOME/.hermes/skills/hermes-mods/memo" "$HOME/.hermes/skills/hermes-mods/ssh-info"',
    'rm -f "$HOME/.hermes/mod-bridge/todos.json" "$HOME/.hermes/mod-bridge/ssh-servers.json"',
    writeFileCmd('.hermes/skills/hermes-mods/memo/todos.json', JSON.stringify(data.todos ?? [], null, 2)),
    writeFileCmd('.hermes/skills/hermes-mods/ssh-info/ssh-servers.json', JSON.stringify(data.sshServers ?? [], null, 2)),
    writeFileCmd('.hermes/skills/hermes-mods/memo/SKILL.md', MEMO_SKILL),
    writeFileCmd('.hermes/skills/hermes-mods/ssh-info/SKILL.md', SSH_SKILL),
  ].join('; ')
  await runWslCommand(['bash', '-lc', cmd])
}

// Read + clear the agent's queued todo commands. Returns parsed command objects;
// applying them against the mod is the caller's job (it owns the mod instance).
export async function drainTodoCommands(): Promise<Array<Record<string, unknown>>> {
  let raw = ''
  try {
    raw = await runWslCommand([
      'bash',
      '-lc',
      'f="$HOME/.hermes/mod-bridge/todo-commands.jsonl"; if [ -f "$f" ]; then cat "$f"; : > "$f"; fi',
    ])
  } catch {
    return []
  }
  if (!raw.trim()) return []
  const out: Array<Record<string, unknown>> = []
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object') out.push(obj as Record<string, unknown>)
    } catch {
      /* skip malformed line */
    }
  }
  return out
}
