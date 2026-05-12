# Hermes Desktop Agent - Windows Native + WSL ACP 实现计划

> 新方案：Electron/React 作为 Windows 原生桌面前端运行；Hermes 后端只在 WSL2 内启动；主通信链路改为通过 `wsl.exe -d <distro> -- hermes acp` 建立 ACP stdio 会话。

---

## 目标结论

当前项目要从“WSLg 中运行 Electron，同时保留 Windows 互操作”调整为“Windows 原生 Electron 是唯一优先入口，WSL 只承载 Hermes 后端执行环境”。

这样做的核心原因：

- Windows 原生 Electron 可以获得稳定的中文输入法候选框、托盘、快捷键、窗口焦点和资源管理器体验。
- Hermes 继续运行在 WSL2，复用 Linux 工具链、用户配置、API key、skills、项目路径和命令执行环境。
- Electron 主进程不再直接假设自己处在 WSL 内，而是通过 Windows 侧 `wsl.exe` 启动 Hermes ACP 后端。
- 前后端协议从宽松的 `hermes chat --source desktop` 输出解析，收敛为 ACP over stdio 的长期主链路。

---

## 产品定位

Hermes Desktop Agent 是一个 Windows 桌面助手壳层，不是浏览器网页，也不再以 WSLg Electron 作为主运行方式。

优先形态：

- Windows 原生桌面窗口
- Windows 原生中文输入法候选框
- Windows 托盘、置顶、快捷键、窗口状态持久化
- 通过 WSL2 启动和管理 Hermes 后端
- 通过 ACP 维护会话、消息、工具调用和状态事件
- 工作区路径同时暴露 Windows 路径和 WSL 路径，但所有 Hermes 任务默认在 WSL 路径中执行

WSLg 只作为开发或回退路径保留，不再作为 README 和计划中的首选方案。

---

## 技术栈

| 层次 | 选型 |
|---|---|
| 桌面运行时 | Windows 原生 Electron |
| 渲染层 | React 19 + TypeScript + Vite |
| 样式与动效 | Tailwind CSS v4 + Framer Motion |
| 状态管理 | Zustand |
| 后端启动 | `wsl.exe -d <distro> -- hermes acp` |
| 主通信协议 | ACP over stdio |
| 路径桥接 | Windows path / UNC WSL path / WSL POSIX path 映射 |
| Windows 能力 | Explorer、剪贴板、全局快捷键、托盘、默认程序 |
| WSL 能力 | Hermes config、skills、workspace、shell/tool execution |

---

## 新系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│                 Windows Desktop Surface                     │
│  IME / Tray / Shortcut / Explorer / Clipboard / Focus        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│              Electron Main Process (Windows)                 │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ WindowManager  │  │ AcpBridge      │  │ WindowsHost    │ │
│  │ native window  │  │ spawn wsl.exe  │  │ file/clipboard │ │
│  │ tray/hotkey    │  │ ACP stdio      │  │ path boundary  │ │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘ │
│          │                   │                   │          │
│          └───────────────────┴──── IPC ──────────┘          │
└──────────────────────┬──────────────────────────────────────┘
                       │ contextBridge
┌──────────────────────┴──────────────────────────────────────┐
│                 Electron Renderer (React)                    │
│                                                              │
│  ┌──────────────┬────────────────────┬────────────────────┐ │
│  │ SkillsPanel  │ ChatPanel          │ WorkspacePanel     │ │
│  │ config view  │ ACP conversation   │ path/files/session │ │
│  └──────────────┴────────────────────┴────────────────────┘ │
│                      Zustand Store                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ stdio: ACP frames
                       │ launched by Windows host
┌──────────────────────┴──────────────────────────────────────┐
│                         wsl.exe                              │
│      wsl.exe -d <distro> --cd <wsl-workspace> -- hermes acp   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│                    Hermes Backend (WSL2)                     │
│  config / skills / tools / shell / workspace / session state  │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键边界

### Windows 前端边界

Windows 侧负责：

- Electron 进程生命周期
- 原生窗口、托盘、快捷键、置顶、最小化、关闭
- 中文输入法候选框验证
- Windows 文件树读取和预览，前提是当前 workspace 是 Windows 路径
- Explorer 打开和定位
- Windows 剪贴板读写
- 启动、停止、重启 WSL 内 Hermes ACP 后端
- 维护 ACP stdio framing、请求 ID、超时、错误展示

Windows 侧不负责：

- 执行 Hermes tool
- 直接读取 WSL 内部 `~/.hermes`，除非通过 `wsl.exe` 或 UNC 路径明确访问
- 假设 `wslpath`、`powershell.exe` 存在于当前 PATH。Windows 原生 host 下应优先使用 Node/Electron/Windows API 或 `wsl.exe`。

### WSL 后端边界

WSL 侧负责：

- 运行 `hermes acp`
- 读取 `~/.hermes/config.yaml`
- 扫描 `~/.hermes/skills/`
- 在 WSL workspace 中执行任务
- 通过 ACP 返回消息、工具调用、工具结果、状态和错误

WSL 侧不负责：

- Electron GUI
- Windows IME
- Windows 托盘和窗口焦点
- Windows Explorer 和剪贴板原生体验

---

## ACP 主链路设计

### 启动命令

基础形式：

```powershell
wsl.exe -d <distro> -- hermes acp
```

带工作目录的目标形式：

```powershell
wsl.exe -d <distro> --cd <wsl-workspace> -- hermes acp
```

Electron 主进程中由 `AcpBridge` 管理：

- 从配置读取 distro 名称，默认允许使用 `wsl.exe -l -q` 的默认发行版
- 把 Windows workspace 映射为 WSL path
- spawn `wsl.exe`，stdio 设为 pipe
- 按 ACP framing 读写消息
- 向渲染层推送连接状态、会话状态和错误事件
- 后端退出时进入离线状态，允许用户手动重连

### 协议层职责

需要新增或重构 `electron/hermes-bridge.ts` 为 ACP bridge：

- `start()`：启动 WSL ACP 后端
- `stop()`：终止子进程
- `restart()`：重启后端
- `sendUserMessage()`：发送用户输入
- `sendCancel()`：取消当前请求
- `requestSessionSnapshot()`：拉取当前会话/模型/能力
- `handleFrame()`：解析 ACP frame 并归一化事件

渲染层不要直接理解 ACP 细节，只消费前端稳定事件：

- `connection:status`
- `assistant:start`
- `assistant:delta`
- `assistant:done`
- `tool:start`
- `tool:delta`
- `tool:done`
- `session:update`
- `backend:error`
- `backend:exit`

---

## 路径模型

新方案必须显式区分三类路径：

| 类型 | 示例 | 用途 |
|---|---|---|
| Windows path | `E:\Hermes-Desktop-Agent` | Windows Electron、Explorer、Windows 文件树 |
| WSL POSIX path | `/mnt/e/Hermes-Desktop-Agent` | `wsl.exe --cd`、Hermes workspace |
| WSL UNC path | `\\wsl.localhost\Ubuntu\home\rison\project` | Windows 访问 WSL 文件系统时使用 |

### 路径转换原则

- Windows host 下不再调用 `wslpath` 作为默认路径转换工具。
- Windows path 到 WSL path 使用 `wsl.exe -d <distro> -- wslpath -u <windows-path>`。
- WSL path 到 Windows path 使用 `wsl.exe -d <distro> -- wslpath -w <wsl-path>`。
- 对 UNC WSL 路径必须识别 distro 和 Linux path，避免误当成本地 Windows 路径。
- 所有文件预览读取都必须先确认 resolved path 位于当前 workspace root 内。
- Windows 文件树和 WSL 文件树要分模式处理，不能混用边界判断。

### 工作区模式

首批支持两种模式：

1. `windows-workspace`
   - Electron 当前目录是 Windows path。
   - 文件树、预览、Explorer 直接用 Windows API。
   - 启动 Hermes 前把 workspace 转成 WSL POSIX path。

2. `wsl-workspace`
   - workspace 来源是 WSL path 或 WSL UNC path。
   - 文件树可通过 UNC path 读取，或通过 ACP/WSL helper 拉取。
   - Hermes 直接使用 WSL POSIX path。
   - Explorer 使用 UNC path 或 Windows 映射路径打开。

---

## 模块改造计划

### 1. package scripts

新增 Windows 原生脚本：

```json
{
  "dev:electron:windows": "wait-on tcp:5173 file:dist-electron/electron/main.js && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron .",
  "electron:windows": "cross-env ELECTRON_IS_DEV=0 electron ."
}
```

保留 WSLg 脚本但降级命名：

```json
{
  "dev:electron:wslg": "wait-on tcp:5173 file:dist-electron/electron/main.js && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 ./scripts/run-with-dbus.sh electron .",
  "electron:wslg": "cross-env ELECTRON_IS_DEV=0 ./scripts/run-with-dbus.sh electron ."
}
```

最终 `npm run dev` 应优先绑定 Windows 原生 Electron；WSLg 只作为显式 fallback。

### 2. electron/hermes-bridge.ts

改造为 `AcpBridge`：

- Windows 下 spawn `wsl.exe`
- 参数由配置生成：`-d <distro> --cd <wslWorkspace> -- hermes acp`
- 删除对 `hermes chat --source desktop` 的默认依赖
- 保留旧 chat bridge 仅作为临时 fallback，不作为主计划
- 增加 ACP frame parser/writer
- 增加 request map、超时、退出码、stderr 归一化

### 3. electron/windows-interop.ts

从“WSL 里调用 Windows 能力”改为“Windows host 原生能力 + WSL path helper”：

- Explorer 打开：使用 Windows path 或 UNC path
- 默认程序打开：使用 Windows path 或 UNC path
- 剪贴板：优先 Electron clipboard API 或 Windows 原生能力
- 路径转换：通过 `wsl.exe ... wslpath`
- WSL 可用性探测：`wsl.exe --status`、`wsl.exe -l -q`
- distro 配置和探测结果回传给渲染层

### 4. electron/main.ts

需要拆清 IPC：

- `backend:start`
- `backend:stop`
- `backend:restart`
- `backend:get-status`
- `hermes:send-message`
- `workspace:get-snapshot`
- `workspace:read-file`
- `workspace:set-root`
- `windows:reveal-workspace`
- `windows:open-workspace`
- `windows:read-clipboard`
- `windows:write-clipboard`

工作区 snapshot 必须返回：

- `hostPlatform`
- `workspaceMode`
- `windowsPath`
- `wslPath`
- `uncPath`
- `distro`
- `backendStatus`

### 5. src 渲染层

渲染层保持三栏结构，但文案和状态要改成新模型：

- 左侧展示 WSL distro、Hermes provider/model、skills
- 中间展示 ACP 连接状态和会话消息
- 右侧展示 Windows path、WSL path、文件树、文件预览、Explorer/clipboard 操作
- 输入框发送前必须确认 ACP 后端在线；离线时给出重连入口

---

## 阶段计划

### P0 - 文档和目标冻结

目标：

- 重写 `PLAN.md`
- README 后续改为 Windows 原生优先
- 明确 WSLg 是 fallback，不再作为主线

验收：

- 文档中不存在“WSLg 直接运行 Electron 是基础方案”的主线描述
- 后续实现按 Windows host / WSL backend / ACP 三层拆分

### P1 - Windows 原生启动链路

目标：

- 在 Windows PowerShell 中安装 Windows 版 `node_modules`
- 新增 `npm run electron:windows`
- 新增或调整 `npm run dev` 以启动 Windows 原生 Electron
- 保留 `electron:wslg` fallback

验收：

- PowerShell 中 `npm install` 成功
- `npm run build` 成功
- `npm run electron:windows` 能打开 Windows 原生窗口
- 中文输入法候选框出现在输入框附近，不再受 WSLg 限制

### P2 - ACP 后端启动

目标：

- Electron 主进程通过 `wsl.exe -d <distro> -- hermes acp` 启动 Hermes
- 支持 distro 配置和默认 distro 探测
- 捕获 stdout/stderr/exit
- 建立最小 ACP 初始化握手

验收：

- Windows host 下能启动 WSL Hermes ACP 子进程
- 后端不可用时 UI 明确显示错误
- 后端退出后 UI 进入离线状态
- 手动重连可重新启动 ACP 后端

### P3 - ACP 消息与工具事件

目标：

- 实现 ACP frame parser/writer
- 用户消息通过 ACP 发送
- assistant delta/done 正常显示
- tool call/tool result 显示为现有工具卡片或升级后的 ACP 工具卡片

验收：

- 输入一条任务后，Hermes 在 WSL 内处理
- 流式输出稳定显示
- 工具调用不会被当成 raw JSON 噪音
- 取消、错误、退出状态有明确 UI 表达

### P4 - Windows host 工作区边界

目标：

- 修正文件树读取边界
- 修正文件预览边界
- 支持 Windows path -> WSL path
- 支持 WSL path -> Windows/UNC path
- Explorer 和默认程序打开在 Windows host 下走原生路径
- 剪贴板读写不再依赖 WSL 内 powershell 调用

验收：

- Windows workspace 下文件树正常
- 文件预览不能越过 workspace root
- WSL workspace 或 UNC workspace 不被错误拒绝
- Explorer 打开的是正确目录
- 写入剪贴板的是用户当前期望的路径形态

### P5 - 配置、技能和会话信息

目标：

- 通过 ACP 或 WSL helper 读取 Hermes provider/model
- 扫描 WSL 内 `~/.hermes/skills`
- 展示当前 distro、workspace、ACP 状态
- 为后续 session 管理预留结构

验收：

- Windows 前端展示的是 WSL Hermes 的真实配置
- skills 来源明确来自 WSL
- UI 不再暗示可以直接在 Windows 本地运行 Hermes

### P6 - README 和交付说明

目标：

- README 改为 Windows 原生优先
- 安装说明区分 Windows PowerShell 和 WSL
- 明确 `npm run electron:windows` 是主入口
- WSLg 说明移动到 fallback/开发排障章节
- 清理未跟踪文件策略，避免提交本地元数据

验收：

- 新用户按 README 在 Windows PowerShell 中可启动应用
- README 明确要求 WSL 内可运行 `hermes acp`
- `CLAUDE.md` 等本地元数据不会进入版本记录

---

## 验证清单

### Windows PowerShell

```powershell
node --version
npm --version
npm install
npm run build
npm run electron:windows
```

### WSL 后端

```powershell
wsl.exe --status
wsl.exe -l -q
wsl.exe -d <distro> -- hermes --version
wsl.exe -d <distro> -- hermes acp
```

### 路径转换

```powershell
wsl.exe -d <distro> -- wslpath -u "E:\Hermes-Desktop-Agent"
wsl.exe -d <distro> -- wslpath -w "/mnt/e/Hermes-Desktop-Agent"
```

### 输入法

- Windows 原生 Electron 窗口中输入中文
- 候选框应贴近输入框
- `Enter` 选词和发送消息不能冲突
- `Shift+Enter` 仍用于换行

### ACP

- 启动后端
- 完成初始化握手
- 发送普通用户消息
- 接收 assistant 流式输出
- 接收工具调用和工具结果
- 后端异常退出后重连

---

## 当前已知风险

- ACP 具体 frame 和 event schema 需要以 Hermes 当前实现为准，不能继续依赖旧 chat 输出猜测。
- Windows 与 WSL 双环境会产生两套 `node_modules`，必须明确 PowerShell 安装的是 Windows Electron 依赖。
- Windows path、WSL POSIX path、UNC path 混用最容易造成文件越界或 Explorer 打开错误，需要优先做结构化路径模型。
- 中文输入法验证必须在 Windows 原生 Electron 中实测，不能用 WSLg 结论替代。
- 如果 Hermes ACP 需要 TTY 或特殊环境变量，`wsl.exe` stdio 启动方式需要额外适配。

---

## 版本记录策略

- 应提交：源码、文档、脚本、锁文件中与 Windows 原生运行相关的确定性改动。
- 应忽略：`node_modules/`、构建产物、日志、本地 `.env`、IDE 私有文件、`CLAUDE.md` 等本地协作元数据。
- 当前未跟踪的 `Hermes-Desktop-Agent.code-workspace` 需要单独判断：如果只是个人 VS Code 工作区配置，不进入版本记录；如果要作为团队统一入口，需要先确认内容足够通用。

---

## 下一步执行顺序

1. 在 Windows PowerShell 中安装 Windows 版依赖。
2. 添加 `electron:windows` 和 Windows dev 启动脚本。
3. 将 Hermes bridge 改造为 `wsl.exe ... hermes acp`。
4. 实现 ACP 最小握手和消息收发。
5. 修正 Windows host 下工作区文件树、文件预览、Explorer、剪贴板边界。
6. 实测 Windows 原生中文输入法候选框。
7. 更新 README 为 Windows 原生优先。
8. 清理未跟踪文件并确认版本记录范围。

---

## 当前优化计划（2026-05-11）

本轮优化目标是在不改变主产品方向的前提下，优先补齐桌面助手的可用性、可测试性和安全边界。

### O1 - 工作区上下文刷新

状态：已完成。

目标：
- 在右侧“工作区 / 上下文与任务”标题区加入刷新按钮。
- 点击刷新后重新拉取 workspace snapshot，更新文件树、路径、任务和 Windows/WSL 状态。
- 如果当前选中文件仍存在，同步重新读取文件预览内容。
- 如果当前选中文件已删除，清空预览，避免显示过期内容。

验收：
- 文件夹新增、删除或修改文件后，点击刷新能正确反映到文件树。
- 当前预览文件内容变更后，点击刷新能显示最新内容。
- 刷新过程中按钮有明确 loading 状态，且不会重复触发并发刷新。

### O2 - 拆分 Electron interop 与纯 WSL/path 能力

状态：已完成。

目标：
- 将 Windows/WSL 路径转换、`wsl.exe` 命令执行等纯 Node 能力移入独立模块。
- `HermesBridge` 不再依赖 `electron/windows-interop.ts`，避免普通 Node 测试时加载 Electron `clipboard` / `shell`。
- 保持 renderer/main 现有 IPC API 不变，避免影响用户操作路径。

验收：
- `npm run build` 通过。
- 普通 Node 脚本可以直接 import `dist-electron/electron/hermes-bridge.js`。
- `windows-interop.ts` 继续作为 Electron native interop 门面，对外 API 保持兼容。

### O3 - ACP 权限审批收敛

状态：已完成。

目标：
- 移除 `session/request_permission` 的无条件自动 allow 倾向。
- 通过 Electron 原生确认框展示权限请求内容，要求用户显式允许或拒绝。
- 未配置权限处理器或审批失败时默认拒绝。

验收：
- Hermes 后端请求权限时，用户必须能看到请求内容。
- 未获用户确认时，不自动选择 allow。
- 拒绝、审批失败、后端退出都能反馈为取消或错误状态。

### O4 - 最近 workspace / session 持久化

状态：已完成。

目标：
- 将最近使用的 workspace root、WSL distro、session id 写入 Electron userData。
- 启动时优先恢复上一次 workspace，而不是始终回到 `process.cwd()`。
- 保留失败回退：路径不存在或 WSL 不可用时回到应用目录并提示。

当前进展：
- 已新增 `workspace-state.json` 持久化。
- 已在启动时恢复最近 workspace root。
- 已在加载 session、切换 workspace、创建/切换 worktree 后写回最近 workspace root。
- session id 已预留写入字段，后续再决定是否自动恢复历史 session，避免启动时隐式改变 ACP 会话上下文。

验收：
- 应用重启后右侧工作区恢复到上次选择的目录。
- WSL distro 展示与实际启动配置一致。
- 恢复失败不会阻塞应用打开。

### O5 - 文件树能力增强

状态：已完成。

目标：
- 当前文件树深度和数量限制较小，后续改为懒加载或按目录展开加载。
- 尊重 `.gitignore` 或提供桌面助手自己的 ignore 规则。
- 对超大文件、二进制文件、不可读文件给出明确预览状态。

当前进展：
- 已为文件预览增加 regular file 检查。
- 已为文件预览增加大小限制。
- 已为常见二进制扩展名和内容采样增加预览拦截。
- 已将预览安全策略纳入 `npm run test:core`。
- 已将文件树改为顶层 snapshot + 展开目录时懒加载。
- 已将默认忽略规则和 `.gitignore` 简单规则统一放在主进程侧执行。
- 已将 ignore 规则和懒加载行为纳入 `npm run test:core`。

验收：
- 中大型仓库下文件树可用，不因一次 snapshot 扫描卡顿。
- 文件预览不会尝试读取明显的二进制或超大文件。
- 越界读取保护继续有效。

### O5a - 核心安全与桥接测试

状态：已完成。

目标：
- 为 Windows/WSL 路径转换建立最小回归验证。
- 为 workspace 文件读取越界判断建立最小回归验证。
- 为 ACP permission 默认拒绝策略建立最小回归验证。
- 提供可重复运行的 `npm run test:core` 命令。

验收：
- `npm run test:core` 通过。
- `HermesBridge` 仍可在普通 Node 环境中导入。
- 测试不依赖 Electron GUI 或真实 Hermes 后端。

### O6 - 编码与维护体验

状态：进行中。

目标：
- 修正 PowerShell/脚本输出中文乱码问题。
- 启动脚本设置 UTF-8 输出环境，减少 README、PLAN、源码文案排障成本。
- 后续文案修改统一保持 UTF-8。

验收：
- `Get-Content README.MD`、`Get-Content PLAN.md` 在推荐启动环境中中文可读。
- 日常构建、启动脚本日志不再出现大面积乱码。

当前进展：
- 已在 `start-hermes-desktop.cmd` 设置 `chcp 65001`、`PYTHONUTF8`、`PYTHONIOENCODING`、`LANG`、`LC_ALL` 和 `HERMES_TEXT_ENCODING`。
- 已在 `scripts/start-windows.ps1` 设置 PowerShell UTF-8 输出和同一组 UTF-8 环境变量。
- 已将 Node 侧命令执行改为 Buffer 接收、显式解码，避免隐式依赖 Windows 默认 code page。
- 已为 Hermes ACP 的 WSL 启动命令注入 `C.UTF-8` locale 和 Python UTF-8 环境。
- 已将 UTF-8 环境与命令输出解码纳入 `npm run test:core`。
- 已新增工具结果 normalization 层，对 assistant chunk、stderr、tool args、tool result 清理控制字符并标记疑似乱码。
- 已将工具结果乱码检测纳入 `npm run test:core`，覆盖中文、`•`、控制字符和典型 mojibake。

后续：
- 本仓库没有 Python execute 沙箱实现，stdout/stderr `sys.reconfigure(...)` 需要在 Hermes 后端或 execute 工具执行器仓库接入。
- 如果后续桌面端接管本地工具执行，需要新增统一 Python bootstrap 模板，禁止裸跑脚本。

### O7 - WSL 发行版自动检测

状态：已完成。

目标：
- 启动脚本未显式传入 `-Distro` 且未设置 `HERMES_WSL_DISTRO` 时，使用 `wsl.exe -l -v` 自动检测默认 WSL 发行版。
- 优先选择带 `*` 的默认发行版；没有默认标记时回退到列表中的第一个发行版。
- 将检测结果写入 `HERMES_WSL_DISTRO`，保证 Electron 主进程和 Hermes bridge 使用同一个发行版。

验收：
- 用户不再必须使用固定的 `Ubuntu-22.04` 发行版名称。
- 多发行版机器上默认使用 `wsl.exe -l -v` 标记的默认发行版。
- 检测不到发行版时启动脚本给出明确错误。

### O8 - Chat input composer enhancements

Status: completed.

Scope:
- Make the chat textarea adapt to multi-line and long text, with bounded height and internal scrolling.
- Add a Codex-like large paste fallback: pasted text over 800 characters is replaced in the prompt by `[pasted XXXX chars]`.
- Add `/` as a desktop-side Hermes command entrypoint.
- Surface Hermes `available_commands_update` events to the renderer.
- Combine Hermes built-in commands and installed Hermes skills in the `/` suggestion list.
- Support keyboard completion with ArrowUp, ArrowDown, Tab, Escape, Enter, and Shift+Enter.

Acceptance:
- Plain chat messages still send as regular `session/prompt` text.
- `/<name> <args>` is sent directly to Hermes.
- Typing `/` shows command and skill suggestions.
- Large paste summaries keep the composer responsive and readable.
- IME composition is not interrupted by Enter-to-send behavior.

### O9 - 对话打断、公式渲染与文件右键操作

状态：已完成。

目标：
- 前端提供当前回合打断按钮，能够终止正在进行的 Hermes 响应。
- 消息渲染支持 LaTeX inline math 和 display math。
- 工作区文件树支持右键菜单，提供打开、在文件资源管理器打开、重命名、复制路径、复制相对路径。

当前进展：
- 已新增 `hermes:cancel-message` IPC，并在 Hermes bridge 中优先调用 `session/cancel`，失败时停止后端作为兜底。
- 已在输入框旁加入当前回合取消按钮。
- 已接入 KaTeX，支持 `$...$`、`\(...\)`、`$$...$$` 和 `\[...\]`。
- 已新增 workspace item IPC：reveal、open、resolve paths、rename。
- 已在文件树加入自绘右键菜单，重命名后刷新 workspace snapshot。

验收：
- `npm run build` 通过。
- `npm run test:core` 通过。
- 构建时 KaTeX 引入后 renderer chunk 超过 500 kB，仅为 Vite size warning，功能构建成功。
