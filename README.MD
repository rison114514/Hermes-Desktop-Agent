# Hermes Desktop Agent

Hermes Desktop Agent 是一个面向 WSL2 / WSLg 场景的 Electron 桌面外壳，用来把 Hermes Agent 以更接近桌面助手的方式运行起来，同时保留与 Windows 原生环境的互操作能力。

它把三部分能力组合到同一个桌面工作区中：

- 面向编码任务的桌面聊天窗口
- Electron 主进程到本地 `hermes chat` 的 stdio 桥接
- WSL 与 Windows 之间的路径、资源管理器、默认应用、剪贴板互操作

## 项目定位

这个项目不是一个普通网页，而是一个常驻桌面的 Hermes 助手壳层。

核心目标：

- 在 WSL2 中运行 Hermes，本体以 Electron 窗口提供交互
- 适配悬浮窗工作流，支持置顶、最小化、托盘常驻、快捷键唤起
- 用三栏布局把技能、聊天、工作区上下文放进同一视图
- 保持未来扩展空间，例如真实文件树、工具调用卡片、会话管理等

## 当前能力

已实现：

- Electron 桌面窗口
  - 自定义标题栏
  - 置顶切换
  - 最小化
  - 托盘菜单
  - `Super+H` 全局快捷键
- React + Vite + Tailwind 渲染层三栏布局
  - 左侧技能面板
  - 中间聊天面板
  - 右侧工作区面板
- Hermes 主进程桥接
  - 启动本地 `hermes chat --source desktop`
  - 接收 stdout / stderr
  - 归一化流式事件并推送到前端
- preload 安全桥接
  - 使用 `contextBridge` 向渲染层暴露有限 API
- Windows 互操作
  - WSL 路径转 Windows 路径
  - 在 Explorer 中定位工作区
  - 用 Windows 默认程序打开工作区
  - 读写 Windows 剪贴板
- 聊天体验增强
  - 支持流式响应显示
  - 支持轻量 Markdown 渲染
  - 支持行内代码与代码块展示
  - 内置轻量代码高亮
  - `Enter` 发送，`Shift+Enter` 换行

## 当前仍未完成

- 工作区文件树目前还是占位数据，不是真实文件系统树
- 工具调用 / 工具结果还没有专门的富卡片展示
- 当前 Markdown 为轻量自实现，暂未覆盖完整 CommonMark 语法
- 生产模式下仍可继续补强 CSP 与安全细节

## 技术栈

- Electron
- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Framer Motion
- Zustand

## 目录结构

```text
hermes-desktop-agent/
├── electron/                 # Electron 主进程、preload、Hermes 桥、Windows 互操作
├── src/                      # React 渲染层
│   ├── components/           # 通用组件
│   ├── panels/               # Skills / Chat / Workspace 三个面板
│   ├── store/                # Zustand 状态管理
│   └── lib/                  # 小型工具函数
├── scripts/                  # 辅助脚本，例如 dbus 启动包装
├── changelog/                # 每日开发记录
├── PLAN.md                   # 当前实现计划与架构说明
├── package.json
└── README.MD
```

## 运行环境要求

推荐环境：

- WSL2 + WSLg
- Node.js 20+
- npm 10+
- 本机已安装 Hermes CLI，并且 `hermes` 在 `PATH` 中可执行
- 已存在 Hermes 用户目录，通常为 `~/.hermes/`

若要启用 Windows 互操作，环境中还需要可用：

- `wslpath`
- `powershell.exe`
- WSL 对 Windows 剪贴板的访问能力

## 安装依赖

如果当前目录尚未安装依赖：

```bash
npm install
```

如果 Electron 的 postinstall 在你的环境里受限，也可以使用之前开发日志中的回避方式：

```bash
npm install --ignore-scripts
```

## 开发模式

启动开发环境：

```bash
npm run dev
```

该命令会同时启动：

- Vite 渲染层开发服务器
- Electron 代码的 TypeScript watch 编译
- 指向本地 Vite 服务的 Electron 应用

应用运行后可用的桌面交互：

- `Super+H`：显示 / 隐藏窗口
- 托盘菜单：显示隐藏、置顶切换、退出
- 标题栏：置顶、最小化、关闭应用

## 构建与预览

构建渲染层与 Electron 代码：

```bash
npm run build
```

预览构建后的桌面应用：

```bash
npm run electron:preview
```

## 基本使用方法

### 1. 启动应用

开发时运行：

```bash
npm run dev
```

构建完成后运行：

```bash
npm run electron:preview
```

### 2. 在聊天框中向 Hermes 发起任务

在输入框中输入内容后：

- 按 `Enter` 直接发送
- 按 `Shift+Enter` 插入换行

Hermes 的输出会以流式方式逐步显示在中间聊天面板。

### 3. 阅读聊天结果

当前消息气泡支持以下常见内容：

- 标题
- 无序 / 有序列表
- 引用块
- 链接
- 行内代码
- fenced code block 代码块

### 4. 使用工作区互操作能力

右侧工作区面板目前可以：

- 查看当前 WSL 工作目录
- 查看映射后的 Windows 路径
- 在 Windows Explorer 中定位当前工作区
- 用 Windows 默认程序打开当前工作区
- 读取 Windows 剪贴板
- 把 Windows 路径复制到剪贴板

### 5. 查看当前 Hermes 配置

左侧配置区域会从 `~/.hermes/config.yaml` 读取当前 Hermes 的 `provider` 和 `model`，并扫描 `~/.hermes/skills/` 下已安装的技能目录。

目前这里只做真实配置展示，还没有接入交互式切换模型。

## 中文快速上手

最短路径如下：

1. 确保 `hermes` 命令可在终端中直接运行
2. 在项目根目录执行 `npm run dev`
3. 等 Electron 窗口打开后，在中间输入框直接描述任务
4. 用右侧工作区面板检查当前路径、Windows 映射路径和剪贴板内容
5. 关闭窗口后可通过托盘或 `Super+H` 再次召回

## 常用命令

```bash
npm run dev
npm run build
npm run electron:preview
```

## 已知说明

- Electron 进程需要能直接调用到 `hermes`
- 在受限沙箱中，Vite 本地端口监听可能需要提升权限
- 当前 Markdown 渲染是轻量自定义实现，优先保证集成简单与构建稳定
- 后续如果接入真实文件树、工具卡片与会话管理，README 也需要同步更新

## 开发记录

开发过程日志位于 `changelog/`：

- `changelog/2026-04-23.md`
- `changelog/2026-04-24.md`
