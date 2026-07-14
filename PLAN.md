# Hermes Desktop Agent — MOD 系统架构计划

## Context

将 Hermes Desktop Agent 重构为可自定义的 DIY Agent 平台。参考游戏中"模组（MOD）"概念，定义规范接口，允许外部加载符合格式的 MOD 来扩展 Agent 功能。

当前代码库规模：约 30 个源文件，是一个良好的重构窗口。

## 后续优化：macOS M 系列兼容性

### 当前状态与风险

- `v0.1.3` 已分别提供 Intel `x64` DMG 和 Apple Silicon `arm64` DMG，当前 M 系列 Mac 可以使用 `arm64` 版本。
- 目前只有本机构建与基础镜像校验，尚未建立覆盖不同 M 系列芯片和 macOS 版本的持续验证矩阵。
- Electron 主程序虽然可以构建为 `arm64`，Hermes 使用的 Python/uv 运行时、可选原生 npm 依赖、MOD 依赖和后续新增组件仍可能意外引入仅支持 `x64` 的二进制。
- 新一代 M 系列芯片或 macOS 更新后，未公证应用、运行时下载地址和系统安全策略也可能产生新的兼容性问题。

### 优化计划

1. 在发布流程中固定生成并保留 `x64`、`arm64` 两套 DMG，禁止用 Intel 包替代或覆盖 Apple Silicon 包。
2. 增加自动化架构检查，验证 Electron 主程序、应用内原生模块以及下载后的 Hermes/Python 运行时均与目标架构一致。
3. 建立 macOS 测试矩阵，至少覆盖 Intel、早期 M 系列和发布时可获得的新一代 M 系列设备，并记录 macOS 版本。
4. 为 DMG 增加首次启动冒烟测试：安装、Hermes/ACP 一键配置、新建会话、MOD 加载和正常退出。
5. 评估 Universal 2 `.app`/DMG；只有在 Electron、Hermes Python 运行时和全部原生依赖可稳定合并时才改为单包发布，否则继续提供双架构包。
6. 配置 Apple Developer ID 签名与 notarization，降低未来 macOS Gatekeeper 策略变化造成的启动失败风险。

### 发布验收标准

- Release 必须同时存在名称明确的 `arm64` 与 `x64` DMG。
- `file`/`lipo` 检查结果必须与产物架构标识一致。
- Apple Silicon 冒烟测试必须在未安装 Hermes 的干净用户环境中通过。
- 任一目标架构验证失败时，不得将该版本标记为正式 Latest Release。

## 架构概览 — 三层模型

```
┌─────────────────────────────────────────────────┐
│              MOD 层（用户创作）                    │
│  hermes-mod.json + skills/ + panels/ + hooks/    │
├─────────────────────────────────────────────────┤
│           适配器层（Hermes Desktop）               │
│  mod-loader.ts  →  扫描、验证、加载、生命周期管理    │
├─────────────────────────────────────────────────┤
│             核心层（不变的基础设施）                 │
│  stores / IPC / chat pipeline / layout shell     │
└─────────────────────────────────────────────────┘
```

## MOD 规范定义

### `hermes-mod.json` 清单

```json
{
  "name": "my-mod",
  "version": "1.0.0",
  "description": "一个示例 MOD",
  "author": "your-name",
  "icon": "globe",
  "entry": "index.js",
  "hermesVersion": ">=0.1.0",
  "permissions": ["skills", "panels", "hooks", "ipc", "config", "fs"],
  "config": {
    "vaultPath": { "type": "string", "default": "", "label": "Vault 路径" },
    "maxItems": { "type": "number", "default": 5, "label": "最大条目数" }
  },
  "skills": [
    { "id": "web-search", "name": "网页搜索", "description": "...", "category": "搜索" }
  ],
  "commands": [
    { "id": "my-cmd", "name": "my-command", "description": "..." }
  ]
}
```

`permissions` 的值及含义：

| 权限 | 说明 |
|---|---|
| `skills` | 向 Agent 注册新技能/工具（显示在工具路由面板） |
| `commands` | 注册斜杠命令（显示在输入框 / 提示中） |
| `panels` | 注入 UI 面板组件到侧边栏 |
| `hooks` | 拦截消息/系统提示/上下文处理 |
| `ipc` | 注册 Electron IPC 处理器（主进程） |
| `config` | 使用 MOD 自身的持久化配置存储 |
| `fs` | 访问本地文件系统（项目目录范围内的读写权限） |

### MOD 目录结构

```
E:\Hermes-Desktop-Agent\
  mods/                        # ← MOD 根目录（项目内，与 ~/.hermes/ 分离）
    my-mod/
      hermes-mod.json          # 清单
      index.js                 # 入口：导出 skills/panels/hooks
      package.json             # npm 依赖（可选）
      node_modules/            # MOD 自身依赖
      assets/                  # 图标、静态资源
```

扫描路径为 `path.join(process.cwd(), 'mods')`。

### MOD 入口导出接口

```ts
// <project>/mods/<mod-name>/index.js
export default {
  // === 扩展 Agent 能力 ===
  skills: SkillItem[],              // 注册新技能，显示在工具路由面板
  commands: CommandItem[],          // 注册新命令，显示在斜杠提示中

  // === 扩展 UI ===
  panels: {
    sidebar?: React.FC,             // 注入到左侧边栏（技能面板下方）
    chatHeader?: React.FC,          // 注入到聊天头部
    workspace?: React.FC,           // 注入到右侧边栏
  },

  // === 修改 Agent 行为 ===
  hooks: {
    systemPrompt?: (base: string) => string,          // 修改 system prompt（注入人格、规则等）
    onUserMessage?: (text: string) => string,         // 消息发送前处理
    onBeforeResponse?: (msg: Message) => Message,     // 响应展示前处理
    onToolCall?: (tool: ToolCallState) => ToolCallState,
    onBuildContext?: (context: Message[]) => Message[], // 构建上下文前注入记忆
  },

  // === 后端能力 ===
  main: {
    ipcHandlers?: Record<string, (event, ...args) => any>,
    onBackendStart?: () => void,
    onBackendStop?: () => void,
  },

  // === 生命周期 ===
  onEnable?: (ctx: ModContext) => void,    // MOD 被启用时调用
  onDisable?: (ctx: ModContext) => void,   // MOD 被禁用时调用

  // === 默认配置（由 hermes-mod.json 的 config 字段声明 schema）===
  defaultConfig?: Record<string, any>,
}

// MOD 上下文：框架注入的工具函数
interface ModContext {
  modName: string
  getConfig: (key: string) => any              // 读取该 MOD 的持久化配置
  setConfig: (key: string, value: any) => void // 写入该 MOD 的持久化配置
  logger: { info: Function; warn: Function; error: Function }
}
```

## 核心改动（分 4 阶段，16 个文件）

### 阶段 1：MOD 基础设施（6 个文件）

**新增：**

| # | 文件 | 说明 |
|---|---|---|
| 1 | `src/store/mods.ts` | MOD 注册中心 — Zustand store，包含 `loadMod`/`unloadMod`、`getConfig`/`setConfig`（每个 MOD 独立持久化到 `mods/.hermes-mod-config.json`）、`enableMod`/`disableMod` 生命周期钩子 |
| 2 | `electron/mod-loader.ts` | MOD 扫描器 — `scanModsDirectory()` 扫描 `mods/`、`loadMod(dir)` 读取 manifest + `require(entry)`、`validateManifest(m)` schema 校验、`reloadMod(name)` 热重载 |
| 3 | `src/components/ModPanel.tsx` | MOD 管理面板 — 已安装 MOD 列表、开关、安装/卸载、错误日志 |
| 4 | `src/components/ModMarketplace.tsx` | MOD 市场 — 从 GitHub 索引搜索浏览、一键安装（`git clone`） |

**修改：**

| # | 文件 | 说明 |
|---|---|---|
| 5 | `electron/main.ts` | 添加 IPC：`mods:scan`、`mods:load`、`mods:install`、`mods:uninstall` |
| 6 | `src/panels/SkillsPanel/index.tsx` | 在 ProxyConfig 下方添加 MOD 面板渲染槽位 + "技能 / 模组" 标签切换 |

### 阶段 2：动态注册系统（5 个文件）

| # | 文件 | 说明 |
|---|---|---|
| 7 | `src/store/skills.ts` | 新增 `registerSkills(modName, skills[])` / `unregisterSkills(modName)`，skills 合并：`coreSkills + modSkills` |
| 8 | `src/store/chat.ts` | 新增 `messageHooks` 管道，在 `addMessage`/`appendChunk`/`replaceMessage` 中调用 |
| 9 | `src/app.tsx` | 动态面板注册中心 `modPanels: Map<string, ModPanelExport>`，在布局中渲染 MOD 面板 |
| 10 | `src/panels/ChatPanel/MessagePipeline.ts` | 消息管道 — `runPreSendHooks(text)` / `runPreRenderHooks(msg)` 依次执行所有 hook |
| 11 | `electron/hermes-bridge.ts` | 新增 `registerModIpcHandlers(modName, handlers)`，带 MOD 名前缀避免冲突 |

### 阶段 3：MOD 市场系统（3 个文件）

| # | 文件 | 说明 |
|---|---|---|
| 12 | `src/components/ModMarketplace.tsx` | 市场 UI — 搜索框 + 分类标签 + MOD 卡片 + 详情展开 |
| 13 | `electron/mod-registry.ts` | 注册表同步 — 从 GitHub 获取 MOD 索引 JSON、缓存本地、每日刷新 |
| 14 | `MOD_REGISTRY.md` | 初始注册表 JSON，托管在项目 GitHub 仓库，列出所有可用 MOD |

### 阶段 4：示例 MOD + 场景验证（2 个文件）

| # | 文件 | 说明 |
|---|---|---|
| 15 | `example-mods/hello-world/hermes-mod.json` | 示例 manifest |
| 16 | `example-mods/hello-world/index.js` | 示例入口 |

## 场景验证：三个典型 MOD 如何实现

### 场景 1：人格模板（Persona MOD）

```
mods/hermes-persona/
├── hermes-mod.json
├── index.js            # 注册 systemPrompt hook
└── personas/
    ├── default.json    # 默认助手人格
    ├── coder.json      # 编程专家人格
    └── creative.json   # 创意写手人格
```

- `panels.sidebar` → 人格切换下拉面板
- `hooks.systemPrompt(base)` → 注入当前选中人格的 prompt
- `onEnable(ctx)` → 初始化默认人格
- `ctx.getConfig/setConfig` → 持久化当前人格选择
- 人格切换通过 `addSessionMarker` 标记变化，**不重置对话**（共享上下文记忆）

```json
// personas/coder.json
{
  "name": "编程专家",
  "icon": "code",
  "prompt": "你是一位资深软件工程师。回答时优先给出可运行的代码，使用中文解释核心逻辑。遇到问题先分析根因再给方案。"
}
```

### 场景 2：外置记忆管理（Obsidian MOD）

```
mods/hermes-obsidian/
├── hermes-mod.json
├── index.js
└── package.json
```

- `panels.workspace` → 右侧边栏记忆面板（Vault 文件树、最近笔记）
- `hooks.onBuildContext(context)` → 根据当前话题检索 Obsidian 笔记，注入到上下文
- `hooks.onUserMessage(text)` → 解析 `[[wiki链接]]` 并替换为笔记内容
- `main.ipcHandlers` → `obsidian:search`、`obsidian:read` 等（直接读本地 Markdown 文件）
- `skills` → 注册 `memory-search`、`memory-link`
- `ctx.getConfig/setConfig` → 存储 vault 路径

### 场景 3：远程服务器管理（SSH MOD）

```
mods/hermes-ssh/
├── hermes-mod.json
├── index.js
└── package.json        # 依赖 node-ssh 或 ssh2
```

- `panels.workspace` → 服务器列表、文件树、终端输出
- `main.ipcHandlers` → `ssh:connect`、`ssh:list-files`、`ssh:exec`、`ssh:disconnect`
- `commands` → `/deploy`、`/server-status`
- `skills` → `remote-deploy`
- `ctx.getConfig/setConfig` → 存储加密的服务器连接信息
- `onDisable(ctx)` → 断开所有 SSH 连接

### 接口覆盖矩阵

| MOD 接口 | 场景 1 人格 | 场景 2 记忆 | 场景 3 SSH |
|---|---|---|---|
| `hooks.systemPrompt` | ✅ 注入人格 prompt | — | — |
| `hooks.onUserMessage` | ✅ 格式化输出风格 | ✅ 解析 wiki 链接 | — |
| `hooks.onBuildContext` | ✅ 注入人格规则 | ✅ 注入相关笔记 | — |
| `hooks.onBeforeResponse` | ✅ 风格化回复 | — | — |
| `hooks.onToolCall` | — | — | ✅ 记录部署日志 |
| `panels.sidebar` | ✅ 人格切换面板 | — | — |
| `panels.workspace` | — | ✅ 记忆管理面板 | ✅ 服务器管理面板 |
| `skills` | — | ✅ memory-search | ✅ remote-deploy |
| `commands` | — | — | ✅ /deploy 等 |
| `main.ipcHandlers` | — | ✅ 读写 vault | ✅ SSH 连接 |
| `ModContext.getConfig/setConfig` | ✅ 存储当前人格 | ✅ 存储 vault 路径 | ✅ 存储服务器列表 |
| `onEnable/onDisable` | ✅ 初始化默认人格 | ✅ 连接 vault | ✅ 断开 SSH 连接 |

> **结论**：13 个 MOD 接口点完整覆盖全部三个场景，无遗漏。

## 关键技术决策

### 1. 加载策略

- **启动时扫描**：app.whenReady 后扫描 `mods/`，加载所有启用的 MOD
- **懒加载 UI**：MOD 的 React 组件用 `dynamic import()` 加载
- **热重载**：开发模式下 `fs.watch` 监听 mod 目录，变更后自动 reload
- **错误隔离**：每个 MOD 用 try-catch 包裹加载，一个崩溃不影响其他 MOD 和核心功能

### 2. 消息管道顺序

```
用户输入 → onUserMessage(m1) → onUserMessage(m2) → ... → 发送到 Agent
Agent 输出 → onBeforeResponse(r1) → onBeforeResponse(r2) → ... → 渲染到聊天
```

Hooks 按 MOD 的 `priority` 字段排序（manifest 可选字段，默认 0）。

### 3. 安全边界（宽松模式）

- MOD 运行在 Node.js 主进程，有 `require()` 和 `process` 访问权
- 不做沙箱限制，完全信任用户安装的 MOD
- `permissions` 声明仅作为给用户的提示，不强制执行

### 4. 与现有 Skills 系统的关系

- 现有 Skills 是 Hermes ACP 后端（Python）加载的技能
- MOD Skills 是 JS 端的技能注册，两者互补
- MOD 可以创建一个 skill 来包装后端能力

## 验证

1. `npm run build` — 零错误
2. 手动创建 hello-world MOD 放置到 `mods/`，启动应用验证加载
3. 验证 MOD 注册的技能出现在工具路由面板中
4. 验证 MOD 的 UI 面板出现在侧边栏中
5. 验证消息 hook 正确修改了消息处理流程
