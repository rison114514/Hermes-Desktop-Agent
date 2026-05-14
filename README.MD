# Hermes Desktop Agent

Hermes Desktop Agent 是一个运行在 Windows 上的 Hermes 桌面助手。它使用 Windows 原生 Electron 界面，后台通过 WSL2 启动 Hermes ACP，因此既保留了 Windows 桌面体验，也能继续使用 Hermes 在 Linux/WSL 中的模型、技能和工具执行环境。

它适合用来：

- 在桌面端和 Hermes 对话。
- 加载、恢复和继续历史 session。
- 查看和操作当前工作区文件。
- 使用 Hermes 的内置命令、skills、工具调用和多轮任务能力。

## 使用方式

### 1. 推荐下载 Release 版

普通用户推荐下载 Release 包，然后直接运行：

```text
Hermes Desktop Agent-0.1.0-x64.exe
```

Release 版已经内置桌面前端运行时，不需要在宿主机安装 Node.js 或 npm。
启动后会自动检测可用的 WSL Linux 发行版；如果只检测到 Docker Desktop 的内部发行版，会尝试安装默认 Ubuntu。
如果想在启动桌面端前先检查环境，可以先运行 `setup-hermes-environment.cmd`，它会检测 WSL、Ubuntu、Hermes 和 Hermes model/provider 配置。

### 2. 准备环境

普通用户需要：

- Windows 11，或支持 WSL2 的 Windows 10+。
- PowerShell 5.1 或 PowerShell 7+。

开发者从源码运行时额外需要：

- Node.js 20+。
- npm 10+。

### 3. 从源码一键启动

如果下载的是源码 ZIP 包，解压后双击：

```text
start-hermes-desktop.cmd
```

脚本会自动完成这些事情：

1. 检查 WSL 是否可用；如果没有可用发行版，会尝试安装默认 Ubuntu。
2. 自动检测当前 WSL 发行版。
3. 检查 WSL 内是否安装 Hermes；缺失时会尝试下载并安装。
4. 检查 Hermes model/provider 配置；未配置时会打开 `hermes model` 引导。
5. 安装 Windows 侧 npm 依赖。
6. 构建并启动桌面助手。

如果安装 WSL 后提示需要重启 Windows，请重启后再次双击 `start-hermes-desktop.cmd`。

### 4. 配置模型

首次运行时，如果 Hermes 还没有配置模型，启动脚本会进入：

```bash
hermes model
```

按终端提示选择 provider、填写 API key、选择模型即可。以 DeepSeek 为例：

- Provider: `DeepSeek`
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-pro`

API key 由 Hermes 自己保存；桌面助手不会显示或额外保存你的 key。

## 常用命令

普通启动：

```powershell
.\start-hermes-desktop.cmd
```

指定 WSL 发行版：

```powershell
.\scripts\start-windows.ps1 -Distro Ubuntu
```

强制重新构建后启动：

```powershell
.\scripts\start-windows.ps1 -Build
```

跳过自动安装和模型引导，只检查并启动：

```powershell
.\scripts\start-windows.ps1 -SkipBootstrap
```

开发模式：

```powershell
npm run dev
```

生产构建：

```powershell
npm run build
```

## 常见问题

- 普通用户优先下载 Release 版，不需要安装 Node.js/npm。
- 首次使用前可先运行 `setup-hermes-environment.cmd` 完成 WSL 与 Hermes 环境检查。
- 源码 ZIP 用户需要宿主机安装 Node.js/npm，然后双击启动脚本。
- Windows 侧依赖需要在 Windows PowerShell 中安装，不能复用 WSL 内的 `node_modules`。
- 如果 GitHub 下载较慢或失败，脚本会尝试使用镜像源；如果仍失败，请检查当前网络是否能从 WSL 内访问外网。
- 如果安装 Ubuntu 时 Microsoft Store 返回 403 或下载失败，程序会自动尝试 `wsl --install --web-download -d Ubuntu`。
- Docker Desktop 自带的 `docker-desktop` / `docker-desktop-data` 不是普通 Linux 工作环境，不能用于运行 Hermes；请安装 Ubuntu 等常规 WSL 发行版。
- 如果历史 session 无法恢复，先确认 WSL 内 Hermes 能正常执行 `hermes config check` 和 `hermes doctor`。
