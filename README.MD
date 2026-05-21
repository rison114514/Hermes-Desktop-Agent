# Hermes Desktop Agent

Hermes Desktop Agent 是一个运行在 Windows 上的 Hermes 桌面助手。界面由 Electron 提供，后端通过 WSL2 启动 Hermes ACP，因此可以同时获得 Windows 桌面体验和 Hermes 在 Linux/WSL 中的工具、技能、模型配置能力。

它可以用于：

- 和 Hermes 进行桌面对话。
- 加载、恢复和继续历史 session。
- 查看和操作当前工作区文件。
- 使用 Hermes 内置命令、skills、工具调用和多轮任务能力。

## 推荐使用路径

### 1. 先配置环境

首次使用前，建议先右键管理员运行：

```text
setup-hermes-environment.cmd
```

该脚本会检查并引导配置：

- Windows WSL/虚拟化相关功能。
- Ubuntu WSL 发行版。
- WSL 内的 Hermes。
- Hermes model/provider 配置，默认引导 DeepSeek。

如果脚本提示需要重启 Windows，请重启后再次运行 `setup-hermes-environment.cmd`。

### 2. 环境成功后启动桌面助手

普通用户优先下载 GitHub Release 里的 EXE：

```text
Hermes Desktop Agent-0.1.0-x64.exe
```

Release EXE 已经打包好前端和 Electron 运行时，通常不需要用户在 Windows 宿主机安装 Node.js 或 npm。

如果你下载的是源码 ZIP，或想从源码本地启动，也可以双击：

```text
start-hermes-desktop.cmd
```

源码启动会自动执行：

- 检测本地 Node.js/npm。
- 检测 WSL 和 Hermes。
- 自动 `npm install` 或 `npm ci`。
- 自动构建前端和 Electron 主进程。
- 启动桌面助手。

源码启动要求 Windows 宿主机安装 Node.js 20+。如果没有安装，请到中文官网下载安装：

```text
https://nodejs.cn/download/
```

## 模型配置

首次运行时，如果 Hermes 尚未配置模型，环境脚本会提示粘贴 DeepSeek API Key。也可以跳过，之后在 Ubuntu/WSL 中自行运行：

```bash
hermes model
```

DeepSeek 参考配置：

- Provider: `DeepSeek`
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-pro`

API Key 由 Hermes 自己保存，桌面助手不会额外保存或展示你的 key。

## 常用命令

管理员环境检测：

```powershell
.\setup-hermes-environment.cmd
```

源码本地启动：

```powershell
.\start-hermes-desktop.cmd
```

指定 WSL 发行版启动：

```powershell
.\scripts\start-windows.ps1 -Distro Ubuntu
```

强制重新构建后启动：

```powershell
.\scripts\start-windows.ps1 -Build
```

开发模式：

```powershell
npm run dev
```

生产构建：

```powershell
npm run build
```

打包 Windows Release：

```powershell
npm run dist:win
```

## 常见问题

- 普通用户建议先运行 `setup-hermes-environment.cmd`，确认 WSL/Hermes 可用后再使用 Release EXE。
- 源码 ZIP 用户如果运行 `start-hermes-desktop.cmd`，必须先安装 Windows 版 Node.js 20+。
- WSL 内的 Node.js 不能替代 Windows 宿主机 Node.js；源码前端构建需要 Windows 侧 Node/npm。
- Docker Desktop 自带的 `docker-desktop` / `docker-desktop-data` 不是普通 Linux 工作环境，不能用于运行 Hermes。
- 如果 Microsoft Store 安装 Ubuntu 失败，先关闭代理/VPN，再从 Microsoft Store 安装 Ubuntu，并首次打开 Ubuntu 完成初始化。
