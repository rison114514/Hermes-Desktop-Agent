# Hermes Desktop Agent

Hermes Desktop Agent 是一个基于 Electron 的 Hermes 桌面助手。当前项目已改为原生 native 后端，Windows 和 macOS 都可以使用，不再要求 WSL / Docker / Hyper-V。

当前支持状态：

- Windows：支持原生 Hermes Agent，支持源码启动；Release EXE 可作为普通用户推荐入口。
- macOS：支持原生 Hermes Agent，支持源码启动，并提供可直接安装的 Apple Silicon / Intel DMG。
- Linux：项目没有提供正式使用教程和启动脚本。

它可以用于：

- 和 Hermes 进行桌面对话。
- 加载、恢复和继续历史 session。
- 查看和操作当前工作区文件。
- 在工作台标签页中启动并预览前端项目。
- 使用 Hermes 内置命令、skills、工具调用和多轮任务能力。
- 管理模型供应商、Base URL、API Mode、模型 ID 和 API Key。
- 安装、启用和调试本地 MOD。

## 文档索引

- [MOD 安装与创作指南](./MOD_GUIDE.md)：说明 MOD 放在哪里、如何编写 `hermes-mod.json` / `index.cjs`、如何调试和处理依赖。
- [MOD 系统架构计划](./PLAN.md)：记录 MOD 平台的设计背景和长期架构方向。

## 快速选择

如果你只是想运行：

- Windows 普通用户：直接运行 Release EXE；缺少 Hermes 或 ACP 时，应用会提供“一键配置”。源码用户双击 `start-hermes-desktop.cmd` 也会自动配置。
- macOS 普通用户：安装 DMG 后直接打开应用；缺少 Hermes 或 ACP 时会提供“一键配置”。源码用户也可双击 `start-hermes-desktop.command`。

如果你是开发者：

- 需要 Node.js 20+ 和 npm。
- Windows 使用 `start-hermes-desktop.cmd` 或 `.\scripts\start-windows.ps1`。
- macOS 使用 `./start-hermes-desktop.command`。

## Windows 使用教程

### 1. 一键配置 Hermes Agent

Release EXE 已集成环境检测。首次启动时，如果 Hermes Agent 或 ACP 未就绪，点击“一键配置”，按照弹出的 PowerShell 窗口完成模型配置即可。配置成功后应用会自动重新连接。

ZIP 发布包还会附带以下脚本，可用于手动安装或修复：

```text
setup-hermes-environment.cmd
```

该脚本会：

- 安装/检查原生 Windows 版 Hermes Agent。
- 检查 `hermes acp --check`，缺少 ACP 依赖时自动使用国内 PyPI 镜像修复。
- 引导执行 Hermes 模型配置。
- 为 npm、npx、node-gyp 头文件、Electron 和 Playwright 下载配置国内镜像。
- 默认跳过可选的 Playwright Chromium，避免安装 Hermes 时卡在大文件下载；这不影响 ACP 和桌面会话。
- 不安装 WSL，不依赖 Docker / Hyper-V。

如果确实需要 Hermes 自带的 `browser_*` 工具，可以在 PowerShell 中执行：

```powershell
.\scripts\setup-windows-env.ps1 -InstallBrowserTools
```

该模式会从 npmmirror 下载 Playwright 浏览器文件，而不是直接访问 `cdn.playwright.dev`。

如果脚本提示需要重新打开终端或重启 Windows，请按提示操作后再次运行 Release EXE 或 `setup-hermes-environment.cmd`。

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
- 自动安装或修复原生 Windows Hermes 与 ACP。
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

### 1. DMG 安装

根据 Mac 处理器选择 `arm64`（Apple Silicon）或 `x64`（Intel）DMG，将应用拖入“应用程序”后打开。首次运行检测到 Hermes 或 ACP 缺失时，点击“一键配置”；运行时会安装到用户应用数据目录，更新应用不会删除该环境。

当前 DMG 使用 ad-hoc 签名，尚未使用 Apple Developer ID 公证。其他 Mac 首次打开时可能需要在“系统设置 → 隐私与安全性”中选择“仍要打开”；要实现完全无提示的公开分发，需要配置 Apple 开发者证书和 notarization 凭据。

### 2. 源码一键配置并启动

首次使用时，在项目目录运行：

```bash
chmod +x setup-hermes-environment.command start-hermes-desktop.command scripts/create-macos-launcher.sh
./start-hermes-desktop.command
```

启动脚本会先检查 Hermes Agent 与 ACP；缺失时自动调用 `setup-hermes-environment.command`，配置完成后继续构建和启动桌面端，无需分两步执行。

该脚本会：

- 安装/修复本机 Hermes Agent。
- 优先使用系统已有 Python 3.10+。
- 如果没有 Python，会下载项目内本地 `uv` 运行时。
- 使用 `.hermes-runtime/hermes-venv` 创建本地 Python 环境。
- 尝试 GitHub 加速地址和多个 PyPI 镜像，降低国内网络失败概率。

不要求预先安装 Homebrew、WSL、Docker 或系统 Python。

### 3. 启动桌面助手

源码启动：

```bash
./start-hermes-desktop.command
```

启动脚本会：

- 检查 Node.js 20+ 和 npm。
- 自动安装或修复 Hermes 与 ACP。
- 使用 `.npmrc` / npm 镜像安装依赖。
- 使用 Electron 镜像下载或修复 Electron 运行时。
- 构建并启动桌面助手。

如果没有 Node.js，请先安装 Node.js 20+：

```text
https://nodejs.org/
```

### 4. 创建 macOS `.app` 启动器

可以生成一个类似普通 macOS 应用的轻量启动器：

```bash
npm run create:mac-launcher
```

生成后双击：

```text
release-build/Hermes Desktop Agent Launcher.app
```

注意：这个 `.app` 会调用仓库里的 `start-hermes-desktop.command`。它适合本地使用，但不是签名/公证后的正式发布安装包。

### 5. macOS 常用命令

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
npm run dist:mac
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

## 项目预览

点击右侧“上下文与文件”标题栏中的预览按钮，会新建一个可拖动和分屏的“项目预览”标签页。

预览页支持：

- 自动识别当前工作区中的 Vite、Next.js、Astro、React Scripts、Angular、Vue CLI 等开发脚本。
- 对包含 `index.html` 的项目启动内置静态文件服务器。
- 启动、停止和查看开发服务器日志。
- 使用地址栏访问本机 `localhost` / `127.0.0.1` 服务。
- 自动检测 macOS 或 Windows 上已安装的主流浏览器，并选择其中一个打开当前预览。

为了避免项目页面跳转到不受信任的网站，内嵌预览只允许本机回环地址。开发服务器命令必须来自当前工作区的 `package.json`，应用退出时会自动停止由预览页启动的服务器。

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

- Windows 运行失败：在 Release EXE 中选择“一键配置”，或手动运行发布包附带的 `setup-hermes-environment.cmd`。
- Windows 源码启动失败：确认安装了 Windows 版 Node.js 20+，并重新打开终端。
- macOS 安装 Hermes 很慢：重新运行 `setup-hermes-environment.command`，脚本会复用 `.hermes-runtime` 中已经下载成功的内容。
- macOS Electron 下载或解压不完整：重新运行 `start-hermes-desktop.command`，脚本会优先从本地缓存修复 Electron 运行时。
- macOS 双击 `.command` 提示权限问题：在项目目录运行 `chmod +x setup-hermes-environment.command start-hermes-desktop.command scripts/create-macos-launcher.sh`。
- 模型列表不准确：先选择 provider，再点击模型 ID 输入框旁的刷新按钮从当前 Base URL 拉取 `/models`。
- 退出后终端仍未返回：更新到包含退出修复的版本；关闭窗口和程序坞退出都会清理 Hermes 后台进程。
- WSL 后端已废弃：请使用原生 Windows Hermes Agent。
