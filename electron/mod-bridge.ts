// Mod → Agent bridge.
//
// The Hermes agent runs as `hermes acp` (WSL or native Windows). It loads skills
// from ~/.hermes/skills/<category>/<name>/. It has full shell + file access on
// its backend host, but it CANNOT call Electron mod IPC handlers (connect /
// ssh-exec / todo-add live in the desktop process).
//
// This bridge closes the gap using the channels the agent really has:
//   1. Desktop writes the live mod data into the skill directories under
//      ~/.hermes/skills/ (memo/todos.json, ssh-info/ssh-servers.json)
//      so the agent discovers them alongside their SKILL.md files.
//   2. Desktop installs real SKILL.md files under ~/.hermes/skills/
//      describing where that data is and how to act on it.
//   3. For write-back the agent appends JSONL commands to <mod>-commands.jsonl;
//      the desktop drains + applies them on the next turn.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runWslCommand } from './wsl-paths.js'
import { getBackendProvider } from './backend.js'

export interface ModBridgeData {
  todos: unknown[]
  sshServers: unknown[]
  disciplinePlans: unknown[]
  disciplineTemplates: unknown[]
}

function makeMemoSkill(hermesHome: string): string {
  return `---
name: 用户任务备忘录
description: 读取并管理用户在 Hermes 桌面应用中的任务备忘列表（待办、DDL）
---

# 用户任务备忘录

用户在桌面应用侧边栏维护着一个任务备忘列表。完整数据已同步到本机文件：

\`${hermesHome}/skills/memo/todos.json\`

## 读取任务
直接读取该 JSON 文件即可获得全部任务。每个任务字段：
- title 标题
- detail 详情
- urgency 紧急程度 (low/medium/high)
- importance 重要程度 (low/medium/high)
- ddl 截止时间 (ISO 字符串或 null)
- done 是否完成

当用户问"我有哪些待办/备忘/任务"或提到 DDL/截止日期时，读取此文件后回答。

## 修改任务
若用户要求添加/完成/删除任务，向以下文件**追加**一行 JSON（JSONL，每行一个对象）：

\`${hermesHome}/mod-bridge/todo-commands.jsonl\`

支持的命令：
- 添加: {"op":"add","title":"…","detail":"","urgency":"medium","importance":"medium","ddl":null}
- 标记完成/取消完成: {"op":"toggle","index":0}
- 删除: {"op":"remove","index":0}
- 清除已完成: {"op":"clear-done"}

index 为 todos.json 中任务的序号（从 0 开始）。桌面应用每 2 秒轮询一次命令文件，修改后会自动生效。
`
}

function makeSshSkill(hermesHome: string): string {
  return `---
name: 用户的 SSH 服务器
description: 读取用户保存的 SSH 服务器连接信息（含凭据），并通过 shell 直接操作远程服务器
---

# 用户的 SSH 服务器

用户在桌面应用中保存了 SSH 服务器配置。完整信息（含密码 / 密钥路径）已同步到：

\`${hermesHome}/skills/ssh-info/ssh-servers.json\`

每个服务器字段：name, host, port, username, authType (password|key), password, keyPath。

## 连接与执行
你拥有本机的完整 shell 访问权限。要在某台服务器上执行命令，直接用 shell 的 ssh：

- 密钥认证: \`ssh -i <keyPath> -p <port> <username>@<host> "<命令>"\`
- 密码认证: 优先使用密钥。若必须用密码，可用
  \`sshpass -p '<password>' ssh -p <port> <username>@<host> "<命令>"\`
  （若未安装 sshpass，提示用户或改用密钥）。

首次连接某主机若遇 host key 确认，可加 \`-o StrictHostKeyChecking=accept-new\`。

当用户说"连接我的服务器 / 查看服务器 / 部署"时，从 ssh-servers.json 读取对应主机信息后直接用 shell ssh 操作，不要再询问已保存过的连接信息。
`
}

function makeDisciplineSkill(hermesHome: string): string {
  return `---
name: 自律打卡
description: 读取每日自律计划与目标，写入完成描述和AI总结评分
---

# 自律打卡

用户的自律打卡数据已同步到：

\`${hermesHome}/skills/discipline/discipline-plans.json\`

## 数据结构

### plans（每日计划数组）
- date: 日期 "2026-06-09"
- dayType: "weekday" | "weekend" | "custom"
- schedule: 时间槽数组 [{timeSlot, title, status, description}]
  - timeSlot: "08:00-09:00"
  - status: "pending" | "completed" | "missed"
- dailyGoals: 目标数组 [{title, status, description}]
- aiSummary: AI总结 {score, color, text, createdAt} 或 null
- aiSummaryRequested: 是否已请求AI总结

## 修改数据

向以下文件**追加**一行 JSON（JSONL，每行一个对象）：

\`${hermesHome}/mod-bridge/discipline-commands.jsonl\`

支持的命令：
- 更新时间槽: {"op":"update-schedule","date":"...","index":0,"status":"completed","description":"..."}
- 更新目标: {"op":"update-goal","date":"...","index":0,"status":"completed","description":"..."}
- AI总结: {"op":"save-summary","date":"...","score":85,"color":"green","text":"..."}

## AI 总结评分标准

当用户要求"总结今日/今天自律情况"时：
1. 读取今日数据
2. 统计 schedule 和 dailyGoals 的完成率
3. 计算分数 (0-100)：
   - green (>=80): 完成度优秀
   - orange (60-79): 一般，有待改进
   - red (<60): 完成度差
4. 生成简短评语
5. 通过 save-summary 命令写入总结
`
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

// One base64 payload → one file. base64 is single-quote safe; the redirect
// target uses $HOME inside double quotes so the tilde actually expands.
function writeFileCmd(relPath: string, content: string): string {
  return `printf %s '${b64(content)}' | base64 -d > "$HOME/${relPath}"`
}

// Push current mod data + skill docs to the agent's hermesHome in a single
// operation.
export async function syncModBridge(data: ModBridgeData): Promise<void> {
  const backend = getBackendProvider()
  const hh = backend.hermesHome
  const memoSkill = makeMemoSkill(hh)
  const sshSkill = makeSshSkill(hh)
  const disciplineSkill = makeDisciplineSkill(hh)

  if (backend.type === 'native') {
    const skillsDir = path.join(hh, 'skills')
    const bridgeDir = path.join(hh, 'mod-bridge')
    const memoDir = path.join(skillsDir, 'memo')
    const sshDir = path.join(skillsDir, 'ssh-info')
    const disciplineDir = path.join(skillsDir, 'discipline')

    mkdirSync(bridgeDir, { recursive: true })
    mkdirSync(memoDir, { recursive: true })
    mkdirSync(sshDir, { recursive: true })
    mkdirSync(disciplineDir, { recursive: true })

    // Remove stale files from old location
    try { unlinkSync(path.join(bridgeDir, 'todos.json')) } catch { /* ok */ }
    try { unlinkSync(path.join(bridgeDir, 'ssh-servers.json')) } catch { /* ok */ }

    // Memo
    writeFileSync(path.join(memoDir, 'todos.json'), JSON.stringify(data.todos ?? [], null, 2), 'utf8')
    writeFileSync(path.join(memoDir, 'SKILL.md'), memoSkill, 'utf8')

    // SSH
    writeFileSync(path.join(sshDir, 'ssh-servers.json'), JSON.stringify(data.sshServers ?? [], null, 2), 'utf8')
    writeFileSync(path.join(sshDir, 'SKILL.md'), sshSkill, 'utf8')

    // Discipline
    writeFileSync(path.join(disciplineDir, 'discipline-plans.json'), JSON.stringify({ plans: data.disciplinePlans ?? [], templates: data.disciplineTemplates ?? [] }, null, 2), 'utf8')
    writeFileSync(path.join(disciplineDir, 'SKILL.md'), disciplineSkill, 'utf8')
    return
  }

  const cmd = [
    'mkdir -p "$HOME/.hermes/mod-bridge" "$HOME/.hermes/skills/memo" "$HOME/.hermes/skills/ssh-info" "$HOME/.hermes/skills/discipline"',
    'rm -f "$HOME/.hermes/mod-bridge/todos.json" "$HOME/.hermes/mod-bridge/ssh-servers.json"',
    writeFileCmd('.hermes/skills/memo/todos.json', JSON.stringify(data.todos ?? [], null, 2)),
    writeFileCmd('.hermes/skills/ssh-info/ssh-servers.json', JSON.stringify(data.sshServers ?? [], null, 2)),
    writeFileCmd('.hermes/skills/memo/SKILL.md', memoSkill),
    writeFileCmd('.hermes/skills/ssh-info/SKILL.md', sshSkill),
    writeFileCmd('.hermes/skills/discipline/discipline-plans.json', JSON.stringify({ plans: data.disciplinePlans ?? [], templates: data.disciplineTemplates ?? [] }, null, 2)),
    writeFileCmd('.hermes/skills/discipline/SKILL.md', disciplineSkill),
  ].join('; ')
  await runWslCommand(['bash', '-lc', cmd])
}

// Read + clear the agent's queued todo commands.
export async function drainTodoCommands(): Promise<Array<Record<string, unknown>>> {
  const backend = getBackendProvider()
  let raw = ''

  if (backend.type === 'native') {
    const cmdPath = path.join(backend.hermesHome, 'mod-bridge', 'todo-commands.jsonl')
    try {
      raw = readFileSync(cmdPath, 'utf8')
      writeFileSync(cmdPath, '', 'utf8')
    } catch {
      return []
    }
  } else {
    try {
      raw = await runWslCommand([
        'bash',
        '-lc',
        'f="$HOME/.hermes/mod-bridge/todo-commands.jsonl"; if [ -f "$f" ]; then cat "$f"; : > "$f"; fi',
      ])
    } catch {
      return []
    }
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

// Read + clear the agent's queued discipline commands.
export async function drainDisciplineCommands(): Promise<Array<Record<string, unknown>>> {
  const backend = getBackendProvider()
  let raw = ''

  if (backend.type === 'native') {
    const cmdPath = path.join(backend.hermesHome, 'mod-bridge', 'discipline-commands.jsonl')
    try {
      raw = readFileSync(cmdPath, 'utf8')
      writeFileSync(cmdPath, '', 'utf8')
    } catch {
      return []
    }
  } else {
    try {
      raw = await runWslCommand([
        'bash',
        '-lc',
        'f="$HOME/.hermes/mod-bridge/discipline-commands.jsonl"; if [ -f "$f" ]; then cat "$f"; : > "$f"; fi',
      ])
    } catch {
      return []
    }
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
