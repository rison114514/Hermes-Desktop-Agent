# Hermes Desktop Agent — 实现计划

> 方案：桌面悬浮助手优先，运行于 WSL2 + WSLg，同时保留 WSL2 与 Windows 的双向通讯能力

---

## 技术栈

| 层次 | 选型 |
|---|---|
| 桌面运行时 | Electron 33+ |
| 前端框架 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS v4 + Framer Motion |
| UI 组件 | shadcn/ui |
| 状态管理 | Zustand |
| Hermes 通信 | JSON-RPC over stdio（复用 TUI 协议） |
| WSL2 / Windows 桥接 | PowerShell / `wslpath` / Windows 文件系统映射 / 剪贴板与启动器桥接 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Electron Main Process                    │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │WindowManager│  │HermesProcess │  │WindowsInterop     │ │
│  │悬浮窗/置顶/ │  │Manager       │  │路径转换/剪贴板/    │ │
│  │隐藏唤醒     │  │spawn + pipe  │  │启动器/系统能力桥接 │ │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘ │
│         │                │                    │           │
│         └────────────────┴──────IPC───────────┘           │
└──────────────────────┬──────────────────────────────────────┘
                       │ contextBridge (安全隔离)
┌──────────────────────┴──────────────────────────────────────┐
│                Electron Renderer (React)                   │
│                                                            │
│  ┌────────────┬──────────────────┬──────────────────────┐  │
│  │SkillsPanel │   ChatPanel      │WorkspacePanel        │  │
│  │  左侧栏    │   中央主区        │Windows/WSL Context   │  │
│  └────────────┴──────────────────┴──────────────────────┘  │
│                    Zustand Store                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ JSON-RPC stdio
┌──────────────────────┴──────────────────────────────────────┐
│                Hermes Agent (Python / WSL2)                │
│           hermes chat —— 现有 session/tool 体系             │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ Windows integration channel
┌──────────────────────┴──────────────────────────────────────┐
│                   Windows Desktop Surface                   │
│      快捷方式 / 剪贴板 / Windows 路径 / 文件资源管理器       │
└─────────────────────────────────────────────────────────────┘
```

---

## 产品定位

- 目标形态是独立桌面助手，而不是浏览器网页
- 默认以悬浮小窗运行，可置顶、隐藏、召回、托盘常驻
- 前端虽由 React 渲染，但只服务于 Electron 窗体
- Hermes 继续运行在 WSL2 内，应用本体优先贴合桌面助手交互
- 保留与 Windows 的互操作能力，用于路径跳转、剪贴板、文件打开、启动入口等

---

## 布局设计（悬浮助手版）

```
┌──────────────────────────────────────────────────────┐
│ ⚕ Hermes          [skills][workspace]  [─][□][×]    │
├─────────────┬────────────────────────┬───────────────┤
│             │                        │               │
│  SKILLS     │      CHAT              │  WORKSPACE    │
│  ─────────  │  ─────────────────     │  ──────────   │
│  □ web      │  ┌─ Assistant ───────┐ │  📁 ~/proj   │
│  □ github   │  │ 你好，有什么可以  │ │    ├ src/    │
│  □ arxiv    │  │ 帮你的？         │ │    └ README  │
│  ■ terminal │  └──────────────────┘ │               │
│             │  ┌─ User ────────────┐ │  📋 Tasks    │
│  CONFIG     │  │ 帮我分析这个文件  │ │  ─────────   │
│  ─────────  │  └──────────────────┘ │  ○ task 1    │
│  model:     │                        │  ● task 2    │
│  doubao-... │  ┌────────────────────┐│               │
│             │  │ 输入消息...    [↑] ││  🔌 Session  │
│             │  └────────────────────┘│  abc123...   │
└─────────────┴────────────────────────┴───────────────┘
```

---

## 目录结构

```
hermes-desktop-agent/
├── electron/
│   ├── main.ts              # 主进程：窗口、托盘、IPC
│   ├── preload.ts           # contextBridge 安全暴露 API
│   └── hermes-bridge.ts     # Hermes 子进程管理 + JSON-RPC
│   └── windows-interop.ts   # WSL2 <-> Windows 互操作封装
├── src/
│   ├── app.tsx
│   ├── store/
│   │   ├── chat.ts          # 消息历史、流式输出
│   │   ├── skills.ts        # 技能列表、启用状态
│   │   └── workspace.ts     # 项目路径、session
│   ├── panels/
│   │   ├── ChatPanel/
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── InputBar.tsx
│   │   ├── SkillsPanel/
│   │   │   ├── SkillList.tsx
│   │   │   └── ModelConfig.tsx
│   │   └── WorkspacePanel/
│   │       ├── FileTree.tsx
│   │       ├── TaskList.tsx
│   │       └── SessionInfo.tsx
│   └── components/
│       ├── TitleBar.tsx     # 自定义无边框标题栏
│       └── ResizeHandle.tsx
├── package.json
├── vite.config.ts
├── PLAN.md                  # 本文件
└── .env                     # 本地环境变量（不入库）
```

---

## 关键实现细节

### 1. 桌面悬浮窗配置（electron/main.ts）

```typescript
const win = new BrowserWindow({
  width: 900, height: 620,
  frame: false,
  transparent: false,
  alwaysOnTop: true,
  skipTaskbar: false,
  resizable: true,
  movable: true,
  fullscreenable: false,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  }
})
```

全局快捷键唤醒：
```typescript
globalShortcut.register('Super+H', () => {
  win.isVisible() ? win.hide() : win.show()
})
```

补充行为目标：

- 首次启动定位到桌面右侧或上次停靠位置
- 支持一键隐藏到托盘，保持 Hermes 会话不断开
- 支持 `always-on-top` 开关，适应不同工作流
- 后续可扩展为边缘吸附、透明度调节、点击外部自动收起

### 2. Hermes 通信桥（electron/hermes-bridge.ts）

```typescript
import { spawn, ChildProcess } from 'child_process'

let hermes: ChildProcess | null = null

export function startHermes() {
  hermes = spawn('hermes', ['chat', '--source', 'desktop'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  })

  hermes.stdout!.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean)
    lines.forEach(line => {
      try {
        const event = JSON.parse(line)
        mainWindow.webContents.send('hermes:event', event)
      } catch { /* 非 JSON 行（spinner 等）忽略 */ }
    })
  })
}

export function sendMessage(text: string) {
  hermes?.stdin?.write(text + '\n')
}
```

### 3. WSL2 与 Windows 通讯桥（electron/windows-interop.ts）

```typescript
import { execFile } from 'node:child_process'

export function toWindowsPath(pathInWsl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('wslpath', ['-w', pathInWsl], (error, stdout) => {
      if (error) return reject(error)
      resolve(stdout.trim())
    })
  })
}

export function revealInExplorer(pathInWsl: string) {
  return toWindowsPath(pathInWsl).then((winPath) =>
    execFile('powershell.exe', ['-NoProfile', '-Command', 'Start-Process', 'explorer.exe', winPath]),
  )
}
```

桥接职责：

- WSL 路径与 Windows 路径互转
- 从应用中直接打开 Windows 资源管理器或默认程序
- 访问 Windows 剪贴板、通知、启动器入口
- 为后续“Windows 侧唤醒应用、WSL2 侧执行 Hermes”提供统一边界

### 4. 流式消息渲染（src/store/chat.ts）

```typescript
import { create } from 'zustand'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface ChatStore {
  messages: Message[]
  addMessage: (msg: Message) => void
  appendChunk: (id: string, chunk: string) => void
  finalizeMessage: (id: string) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendChunk: (id, chunk) => set((s) => ({
    messages: s.messages.map((m) =>
      m.id === id ? { ...m, content: m.content + chunk } : m
    )
  })),
  finalizeMessage: (id) => set((s) => ({
    messages: s.messages.map((m) =>
      m.id === id ? { ...m, streaming: false } : m
    )
  }))
}))
```

### 5. 三栏布局核心（src/app.tsx）

```tsx
export default function App() {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 rounded-xl overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <SkillsPanel className="w-56 shrink-0 border-r border-zinc-800" />
        <ChatPanel className="flex-1" />
        <WorkspacePanel className="w-64 shrink-0 border-l border-zinc-800" />
      </div>
    </div>
  )
}
```

---

## 实现阶段

| 阶段 | 内容 | 目标产出 |
|---|---|---|
| **P1** 脚手架 | Electron + Vite + React + Tailwind，悬浮窗、托盘、快捷键 `Super+H` | 独立桌面助手可启动 |
| **P2** 布局骨架 | 三栏布局，可拖拽分隔条，折叠/展开面板，自定义标题栏 | 悬浮助手界面骨架完成 |
| **P3** Hermes 桥 | stdio 子进程管理，连接状态指示，重连逻辑 | 可与 WSL2 中的 Hermes 通信 |
| **P4** Windows 互操作 | 路径转换、Explorer 打开、Windows 剪贴板与通知桥接 | WSL2 / Windows 联动可用 |
| **P5** 聊天功能 | 流式消息渲染，Markdown + 代码高亮，工具调用卡片展示 | 完整聊天体验 |
| **P6** 技能面板 | 读取 `~/.hermes/skills/`，启用/禁用开关，快速斜杠命令入口 | 技能可视化管理 |
| **P7** 工作区面板 | 项目路径切换，session 历史列表，todo 列表，Windows 资源跳转 | 上下文可管理 |
| **P8** 精修 | 动画、毛玻璃、键盘导航、边缘吸附、窗口记忆 | 生产级桌面助手品质 |

---

## WSL2 / Windows 运行说明

基础方案仍然是通过 WSLg 直接运行 Electron，这样 Hermes 子进程可在同一侧自然启动；同时预留 Windows 互操作层：

```bash
# 首次安装 JS 依赖
cd /home/rison/hermes-desktop-agent
npm install

# 确认 WSLg 可用
echo $DISPLAY   # 应输出 :0 或类似值

# 启动开发模式
npm run dev

# 构建
npm run build
npm run electron:preview
```

### WSLg / Electron 系统依赖

在 Ubuntu 22.04 的 WSL2 环境中，Electron 至少需要 GTK 运行库；当前已确认缺失 `libgtk-3.so.0` 会直接导致二进制无法启动。

建议先安装完整的一组常用 Electron GUI 依赖：

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-0 \
  libnotify4 \
  libnss3 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  libatspi2.0-0 \
  libdrm2 \
  libgbm1 \
  libasound2
```

如果只补当前已确认的关键缺失项，最小命令是：

```bash
sudo apt-get update
sudo apt-get install -y libgtk-3-0
```

### 运行前自检

安装系统依赖后，建议按顺序验证：

```bash
# 1. 确认 Electron 二进制已存在
test -x node_modules/electron/dist/electron && echo ok

# 2. 检查是否还有缺失系统库
ldd node_modules/electron/dist/electron | rg 'not found' || true

# 3. 验证 Electron 本体能否启动
node_modules/electron/dist/electron --version

# 4. 启动桌面应用
npm run electron:preview
```

说明：

- 如果第 2 步仍然出现 `not found`，继续补对应 apt 包后再验证
- 如果第 3 步报 `Gtk-WARNING` 或显示相关错误，优先检查 WSLg、`DISPLAY`、图形会话是否正常
- 如果第 4 步能拉起窗口但前端空白，再检查 `dist/` 与 `dist-electron/` 是否已重新构建

设计约束：

- Hermes 子进程在 WSL2 内直接 spawn，路径、配置、API key 全部继承当前环境
- Electron 窗口仍是独立桌面应用，不要求浏览器参与
- 需要保留 WSL2 与 Windows 的互通接口，而不是把应用封死在 Linux 侧
- Windows 侧能力以“辅助集成”为目标，不改变 Hermes 必须运行在 WSL2 内这一前提

首批保留的 Windows 相关功能：

- 打开 Windows 资源管理器并定位到当前工作区
- WSL 路径与 Windows 路径双向转换
- 读取或写入 Windows 剪贴板
- 预留从 Windows 快捷方式/脚本唤醒 WSLg 应用的入口

### 当前验证状态（2026-04-23）

- `npm run build` 已通过
- Electron Linux 二进制已手动下载并放入 `node_modules/electron/dist/`
- 当前已确认的系统级阻塞点是缺少 GTK 运行库
- 在完成 apt 依赖安装前，无法完成 Electron GUI 实机启动验证
