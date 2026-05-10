# Hermes Desktop Agent

Hermes Desktop Agent 是一个 Windows 原生 Electron 桌面前端。前端窗口运行在 Windows 中，Hermes 后端运行在 WSL2 中，双方通过 ACP over stdio 通信。

当前主路线：

- Windows 原生 Electron / React 前端。
- WSL2 中启动 `hermes acp --accept-hooks`。
- Electron 主进程通过 `wsl.exe -d <distro> --cd <workspace> -- bash -lc "exec hermes acp --accept-hooks"` 管理后端。
- Windows 原生输入法、托盘、快捷键、Explorer、剪贴板。
- Hermes 配置、skills、工具执行和工作目录仍在 WSL 中。

WSLg 只作为开发或回退路径保留，不再是推荐运行方式。

## 最新能力

- Windows 原生桌面窗口
  - 自定义标题栏、置顶、最小化、托盘菜单。
  - `Super+H` 全局快捷键唤回窗口。
  - Windows 中文输入法候选框可正常跟随输入框。
- ACP 对话链路
  - 支持 `initialize`、`session/new`、`session/list`、`session/load`、`session/prompt`。
  - 支持流式 assistant delta、工具调用卡片、stderr/status 展示。
  - 后端 INFO 日志会被过滤，避免污染聊天区。
- 历史 session
  - 右侧 Workspace 面板可通过下拉框加载 Hermes ACP 历史 session。
  - 加载 session 时会切换到 session 对应的工作目录。
- Git worktree
  - 可列出现有 git worktree。
  - 可切换到指定 worktree，并在新目录启动新的 ACP session。
  - 可新建 worktree，自定义 worktree 名称。
  - 可通过 Windows 原生目录选择器指定 worktree 工作目录。
  - 新建或切换 worktree 后会刷新文件树，并重置聊天视图。
- Windows workspace
  - 读取真实文件树。
  - 文件内容预览带工作区边界检查。
  - 显示 Windows path、WSL POSIX path、UNC path。
  - 可通过右侧 Workspace 卡片切换普通工作目录。
  - 支持 Explorer 定位、默认程序打开、Windows 剪贴板读写。
- WSL Hermes 信息
  - 从 WSL `~/.hermes/config.yaml` 读取 provider/model。
  - 从 WSL `~/.hermes/skills/` 扫描已安装 skills。

## 环境要求

Windows 侧：

- Windows 11，或支持 WSL2 的 Windows 10+。
- Node.js 20+。
- npm 10+。
- PowerShell 可执行 `wsl.exe`。

WSL 侧：

- 已安装 Hermes CLI。
- login shell 中可执行 `hermes`。
- `hermes acp --help` 可正常输出。
- 已存在 `~/.hermes/` 配置目录。

默认 WSL 发行版为 `Ubuntu-22.04`。如需覆盖：

```powershell
$env:HERMES_WSL_DISTRO = "Ubuntu-22.04"
```

## 一键启动

在 Windows 文件资源管理器中双击：

```text
start-hermes-desktop.cmd
```

该脚本会：

- 切到项目根目录。
- 检查 Node.js、npm、WSL 和 Hermes ACP。
- 如果 `node_modules` 不存在，自动执行 `npm install`。
- 如果构建产物不存在，自动执行 `npm run build`。
- 启动 Windows 原生 Electron 前端。

也可以在 PowerShell 中运行：

```powershell
.\start-hermes-desktop.cmd
```

指定 WSL 发行版：

```powershell
.\scripts\start-windows.ps1 -Distro Ubuntu-22.04
```

强制重新构建后启动：

```powershell
.\scripts\start-windows.ps1 -Build
```

## 手动安装与运行

进入项目根目录：

```powershell
cd E:\Hermes-Desktop-Agent
npm install
```

注意：Windows 原生 Electron 需要 Windows 版 `node_modules`。如果之前只在 WSL 内安装过依赖，需要在 Windows PowerShell 中重新执行 `npm install`。

开发模式：

```powershell
npm run dev
```

生产预览：

```powershell
npm run build
npm run electron:windows
```

兼容旧命令：

```powershell
npm run electron:preview
```

该命令当前等价于 `npm run electron:windows`。

## WSL 后端自检

```powershell
wsl.exe --status
wsl.exe -l -q
wsl.exe -d Ubuntu-22.04 -- bash -lc "command -v hermes && hermes --version"
wsl.exe -d Ubuntu-22.04 -- bash -lc "hermes acp --help"
```

路径转换自检：

```powershell
wsl.exe -d Ubuntu-22.04 -- wslpath -u "E:\Hermes-Desktop-Agent"
wsl.exe -d Ubuntu-22.04 -- wslpath -w "/mnt/e/Hermes-Desktop-Agent"
```

## 基本使用

1. 启动 `start-hermes-desktop.cmd`，或手动运行 `npm run electron:windows`。
2. 在中间聊天面板输入任务。
3. Electron 主进程通过 ACP 将消息发送给 WSL 内 Hermes。
4. Hermes 回复以流式方式显示在聊天面板。
5. 右侧 Workspace 面板可查看路径、文件树、文件预览、历史 session、worktree 和剪贴板。

输入规则：

- `Enter` 发送。
- `Shift+Enter` 换行。

## Session 使用

右侧 `Session` 区域提供历史会话下拉框：

- `Refresh`：刷新 ACP 历史 session。
- `Load`：加载选中的历史 session。

加载历史 session 时，桌面端会：

- 读取该 session 的 Hermes `cwd`。
- 切换右侧文件树和预览边界。
- 调用 ACP `session/load` 恢复对话。

## 工作目录切换

右侧 `Workspace` 卡片显示当前普通工作目录。

- `Change`：打开 Windows 原生目录选择器。
- `Refresh`：刷新当前工作区快照、文件树和路径信息。
- 选择目录后会切换文件树、路径信息和文件预览边界。
- 切换后会在新目录启动新的 ACP session，并重置聊天视图。

普通工作目录不要求一定是 git 仓库。若目录不是 git 仓库，worktree 下拉列表会为空，但聊天和文件预览仍可使用。

## Worktree 使用

右侧 `Worktree` 区域提供 worktree 管理：

- 下拉框：列出当前仓库已有 worktree。
- `Switch`：切换到选中 worktree，并启动新的 ACP session。
- `New worktree name`：可选，自定义 worktree 名称。
- `Browse`：打开 Windows 原生目录选择器，选择 worktree 的父目录。
- `New`：创建 worktree，进入新目录，并启动新的 ACP session。

默认行为：

- 未填写名称时，自动生成 `hermes-<timestamp>-<commit>`。
- 未选择目标目录时，默认创建到 `<repo>/.worktrees/<name>`。
- 选择目标目录时，实际创建到 `<选择的目录>/<name>`，不会直接占用已存在的父目录。
- 自定义名称会生成分支 `hermes/<name>`。
- 如果同名分支或目录已经存在，会自动追加 `-2`、`-3` 等后缀。
- 创建或切换 worktree 后，聊天视图会重置为新的 session 上下文。

## 常用命令

```powershell
npm run dev
npm run build
npm run electron:windows
npm run dev:wslg
npm run electron:wslg
```

## WSLg 回退路径

如果需要在 WSLg 中调试旧路径，可显式运行：

```bash
npm run dev:wslg
npm run electron:wslg
```

WSLg 路径依赖 Linux Electron 图形库和 DBus 环境，主要用于排障，不是当前主运行方式。

## 目录结构

```text
Hermes-Desktop-Agent/
├─ electron/                 # Electron main、preload、ACP bridge、Windows/WSL interop
├─ src/                      # React renderer
│  ├─ components/            # 通用组件
│  ├─ panels/                # Skills / Chat / Workspace
│  ├─ store/                 # Zustand stores
│  └─ lib/                   # 小型工具函数
├─ scripts/                  # Windows/WSLg 启动脚本
├─ changelog/                # 开发记录
├─ PLAN.md                   # Windows native + WSL ACP 实现计划
├─ start-hermes-desktop.cmd  # Windows 一键启动入口
├─ package.json
└─ README.MD
```

## 已知后续工作

- 增加 worktree 删除/清理、dirty 状态和提交摘要展示。
- 完善 ACP terminal/fs 代理请求的 UI 审批与执行策略。
- 支持手动选择 WSL distro 和默认 workspace root。
- 持久化最近使用的 workspace/worktree，以便重启后恢复。

## 开发记录

开发过程日志位于 `changelog/`：

- `changelog/2026-04-23.md`
- `changelog/2026-04-24.md`
- `changelog/2026-05-09.md`
