# Hermes Desktop Agent

Hermes Desktop Agent 是一个基于 Electron 的 Hermes 桌面助手。当前项目已改为原生 native 后端，Windows 和 macOS 都可以使用，不再要求 WSL / Docker / Hyper-V。

当前支持状态：

- Windows：支持原生 Hermes Agent，支持源码启动；Release EXE 可作为普通用户推荐入口。
- macOS：支持原生 Hermes Agent，支持源码启动；可生成轻量 `.app` 启动器，但目前不是签名/公证后的正式 macOS 安装包。
- Linux：项目没有提供正式使用教程和启动脚本。

它可以用于：

- 和 Hermes 进行桌面对话。
- 加载、恢复和继续历史 session。
- 查看和操作当前工作区文件。
- 使用 Hermes 内置命令、skills、工具调用和多轮任务能力。
- 管理模型供应商、Base URL、API Mode、模型 ID 和 API Key。
- 安装、启用和调试本地 MOD。

## 文档索引

- [MOD 安装与创作指南](./MOD_GUIDE.md)：说明 MOD 放在哪里、如何编写 `hermes-mod.json` / `index.cjs`、如何调试和处理依赖。
- [MOD 系统架构计划](./PLAN.md)：记录 MOD 平台的设计背景和长期架构方向。

## 快速选择

如果你只是想运行：

- Windows 普通用户：先运行 `setup-hermes-environment.cmd`，然后使用 Release EXE 或双击 `start-hermes-desktop.cmd`。
- macOS 普通用户：先运行 `setup-hermes-environment.command`，然后双击 `start-hermes-desktop.command`；也可以生成 `.app` 启动器。

如果你是开发者：

- 需要 Node.js 20+ 和 npm。
- Windows 使用 `start-hermes-desktop.cmd` 或 `.\scripts\start-windows.ps1`。
- macOS 使用 `./start-hermes-desktop.command`。

## Windows 使用教程

### 1. 安装 Hermes Agent

首次使用前，双击或右键运行：

```text
setup-hermes-environment.cmd
```

该脚本会：

- 安装/检查原生 Windows 版 Hermes Agent。
- 引导执行 Hermes 模型配置。
- 不安装 WSL，不依赖 Docker / Hyper-V。

如果脚本提示需要重新打开终端或重启 Windows，请按提示操作后再次运行 `setup-hermes-environment.cmd`。

### 2. 启动桌面助手

如果使用 Release：

```text
Hermes Desktop Agent-版本号-x64.exe
```

Release EXE 已经打包好前端和 Electron 运行时，通常不需要用户额外安装 Node.js 或 npm。

如果使用源码 ZIP 或 git clone：

```text
start-hermes-desktop.cmd
```

源码启动会自动：

- 检测 Node.js / npm。
- 检测原生 Windows Hermes。
- 安装 npm 依赖。
- 构建前端和 Electron 主进程。
- 启动桌面助手。

源码启动要求 Windows 宿主机安装 Node.js 20+。如果没有安装，请先安装：

```text
https://nodejs.cn/download/
```

### 3. Windows 常用命令

```powershell
.\setup-hermes-environment.cmd
```

```powershell
.\start-hermes-desktop.cmd
```

```powershell
.\scripts\start-windows.ps1 -Build
```

```powershell
npm run dist:win
```

## macOS 使用教程

### 1. 安装 Hermes Agent

首次使用前，在项目目录运行：

```bash
chmod +x setup-hermes-environment.command start-hermes-desktop.command scripts/create-macos-launcher.sh
./setup-hermes-environment.command
```

该脚本会：

- 安装/修复本机 Hermes Agent。
- 优先使用系统已有 Python 3.10+。
- 如果没有 Python，会下载项目内本地 `uv` 运行时。
- 使用 `.hermes-runtime/hermes-venv` 创建本地 Python 环境。
- 尝试 GitHub 加速地址和多个 PyPI 镜像，降低国内网络失败概率。

不要求预先安装 Homebrew、WSL、Docker 或系统 Python。

### 2. 启动桌面助手

源码启动：

```bash
./start-hermes-desktop.command
```

启动脚本会：

- 检查 Node.js 20+ 和 npm。
- 检查 `hermes` 命令是否可用。
- 使用 `.npmrc` / npm 镜像安装依赖。
- 使用 Electron 镜像下载或修复 Electron 运行时。
- 构建并启动桌面助手。

如果没有 Node.js，请先安装 Node.js 20+：

```text
https://nodejs.org/
```

### 3. 创建 macOS `.app` 启动器

可以生成一个类似普通 macOS 应用的轻量启动器：

```bash
npm run create:mac-launcher
```

生成后双击：

```text
release-build/Hermes Desktop Agent Launcher.app
```

注意：这个 `.app` 会调用仓库里的 `start-hermes-desktop.command`。它适合本地使用，但不是签名/公证后的正式发布安装包。

### 4. macOS 常用命令

```bash
./setup-hermes-environment.command
```

```bash
./start-hermes-desktop.command
```

```bash
npm run create:mac-launcher
```

```bash
npm run build
```

## 模型配置

桌面端的“模型配置”面板支持：

- 从内置供应商预设选择 provider。
- 编辑 Base URL。
- 选择 API Mode：OpenAI Chat Completions、Anthropic Messages、Codex Responses、Bedrock Converse。
- 编辑或从接口获取模型 ID。
- 保存 API Key。

内置供应商预设参考 `farion1231/cc-switch` 的 Hermes provider preset，包括 OpenRouter、DeepSeek、阿里百炼、Kimi、智谱 GLM、MiniMax、ModelScope、SiliconFlow、Together AI、Nous Research 等。

也可以在终端中使用 Hermes 自带配置：

```bash
hermes model
```

API Key 由 Hermes 配置保存；桌面端只会显示脱敏后的 Key 状态。

## MOD 使用

MOD 的安装、编写和调试请阅读：

```text
MOD_GUIDE.md
```

桌面端会加载内置 MOD 和用户目录中的 MOD。打包时会排除 MOD 的 `node_modules` 和运行时配置文件，避免把本地状态带进发布包。

## 开发命令

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

核心校验：

```bash
npm run test:core
```

## 常见问题

- Windows 运行失败：先运行 `setup-hermes-environment.cmd`，确认原生 Hermes 可用。
- Windows 源码启动失败：确认安装了 Windows 版 Node.js 20+，并重新打开终端。
- macOS 安装 Hermes 很慢：重新运行 `setup-hermes-environment.command`，脚本会复用 `.hermes-runtime` 中已经下载成功的内容。
- macOS Electron 下载或解压不完整：重新运行 `start-hermes-desktop.command`，脚本会优先从本地缓存修复 Electron 运行时。
- macOS 双击 `.command` 提示权限问题：在项目目录运行 `chmod +x setup-hermes-environment.command start-hermes-desktop.command scripts/create-macos-launcher.sh`。
- 模型列表不准确：先选择 provider，再点击模型 ID 输入框旁的刷新按钮从当前 Base URL 拉取 `/models`。
- 退出后终端仍未返回：更新到包含退出修复的版本；关闭窗口和程序坞退出都会清理 Hermes 后台进程。
- WSL 后端已废弃：请使用原生 Windows Hermes Agent。
