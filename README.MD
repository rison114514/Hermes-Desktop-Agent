# Hermes Desktop Agent

Hermes Desktop Agent 是一个 Windows 原生 Electron 桌面助手。前端窗口运行在 Windows 中，Hermes 后端运行在 WSL2 中，并通过 ACP over stdio 通信。

当前主路线：

- Windows 原生 Electron / React 前端
- `wsl.exe -d <distro> -- hermes acp` 后端
- ACP JSON-RPC stdio 主链路
- Windows 原生输入法、托盘、快捷键、Explorer、剪贴板
- WSL 内 Hermes 配置、skills、工具和工作区执行环境

WSLg 运行 Electron 只保留为开发/回退路径，不再是首选运行方式。

## 当前能力

- Windows 原生 Electron 桌面窗口
  - 自定义标题栏
  - 置顶切换
  - 最小化
  - 托盘菜单
  - `Super+H` 全局快捷键
  - Windows 中文输入法候选框正常跟随输入框
- React + Vite + Tailwind 三栏布局
  - 左侧技能与模型配置
  - 中间 ACP 聊天面板
  - 右侧工作区上下文
- Hermes ACP 桥接
  - Windows 主进程通过 `wsl.exe` 启动 WSL 内 `hermes acp --accept-hooks`
  - 完成 ACP `initialize`、`session/new`、`session/prompt`
  - 接收 `session/update` 并归一化为聊天流、思考状态和工具卡片
  - 过滤 ACP 后端 INFO 日志，避免正常日志污染聊天区
- Windows host 工作区能力
  - 读取真实文件树
  - 文件内容预览
  - Windows path 与 WSL POSIX path 显示
  - Explorer 定位
  - 默认程序打开
  - Windows 剪贴板读写
- WSL Hermes 信息
  - 从 WSL `~/.hermes/config.yaml` 读取 provider/model
  - 从 WSL `~/.hermes/skills/` 扫描已安装技能

## 技术栈

- Electron
- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Framer Motion
- Zustand
- ACP over stdio

## 目录结构

```text
hermes-desktop-agent/
├── electron/                 # Electron 主进程、preload、ACP 桥、Windows/WSL 互操作
├── src/                      # React 渲染层
│   ├── components/           # 通用组件
│   ├── panels/               # Skills / Chat / Workspace 三个面板
│   ├── store/                # Zustand 状态管理
│   └── lib/                  # 小型工具函数
├── scripts/                  # WSLg 回退启动脚本
├── changelog/                # 开发记录
├── PLAN.md                   # Windows native + WSL ACP 实现计划
├── package.json
└── README.MD
```

## 环境要求

Windows 侧：

- Windows 11 或支持 WSL2 的 Windows 10+
- Node.js 20+
- npm 10+
- WSL2 已安装
- Windows PowerShell 中可执行 `wsl.exe`

WSL 侧：

- 已安装 Hermes CLI
- 在 login shell 中可执行 `hermes`
- `hermes acp --help` 可正常输出
- 已存在 `~/.hermes/` 配置目录

当前默认 WSL 发行版为 `Ubuntu-22.04`。可以通过环境变量覆盖：

```powershell
$env:HERMES_WSL_DISTRO = "Ubuntu-22.04"
```

## 安装依赖

在 Windows PowerShell 中进入项目根目录：

```powershell
cd E:\Hermes-Desktop-Agent
npm install
```

注意：Windows 原生 Electron 需要 Windows 版 `node_modules`。如果之前只在 WSL 内安装过依赖，需要在 PowerShell 中重新执行 `npm install`。

## 运行

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

该命令现在等价于 `npm run electron:windows`。

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

1. 在 Windows PowerShell 中运行 `npm run dev` 或 `npm run electron:windows`。
2. Electron 窗口打开后，在中间输入框描述任务。
3. 前端会通过 ACP 把消息发送给 WSL 内 Hermes。
4. Hermes 输出会以流式方式显示在聊天面板。
5. 右侧工作区面板可以查看 Windows 路径、WSL 路径、文件树、文件预览和剪贴板内容。

输入规则：

- `Enter` 发送
- `Shift+Enter` 换行

## 常用命令

```powershell
npm run dev
npm run build
npm run electron:windows
npm run dev:wslg
npm run electron:wslg
```

## WSLg 回退路径

如果需要在 WSLg 中调试旧路径，可以显式运行：

```bash
npm run dev:wslg
npm run electron:wslg
```

WSLg 路径依赖 Linux Electron 图形库和 DBus 环境，主要用于排障，不是当前主运行方式。

## 已知后续工作

- 完善 ACP terminal/fs 代理请求的 UI 审批与执行策略
- 增加手动选择 WSL distro 和 workspace root 的入口
- 将 README 中的运行说明继续随 ACP 能力演进同步更新
- 清理本地 IDE 元数据，避免提交个人工作区文件

## 开发记录

开发过程日志位于 `changelog/`：

- `changelog/2026-04-23.md`
- `changelog/2026-04-24.md`
