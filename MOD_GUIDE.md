# Hermes Desktop Agent MOD Guide

本文说明在原生 Windows 版 Hermes Desktop Agent 中如何安装、编写和调试 MOD。WSL 后端已经废弃，MOD 不应再依赖 WSL 路径、WSL shell 或 `~/.hermes`。

## MOD 放在哪里

Hermes Desktop Agent 会扫描两个位置：

1. 内置 MOD 目录：源码开发时是仓库里的 `mods/<mod-name>`；打包后是应用资源目录里的 `resources/mods/<mod-name>`。
2. 用户 MOD 目录：`%APPDATA%\Hermes Desktop Agent\mods\installed\<mod-name>`。

同名时，用户 MOD 会覆盖内置 MOD。卸载只会删除用户 MOD 目录下的扩展，不会删除应用自带 MOD。

开发仓库内置 MOD 时，把目录放在：

```text
mods/my-mod/
```

给已安装的 Release 添加自定义 MOD 时，把目录复制到：

```text
%APPDATA%\Hermes Desktop Agent\mods\installed\my-mod\
```

复制完成后，打开桌面助手左侧“扩展模块”，点击“扫描”，再启用该 MOD。

## 最小目录结构

```text
my-mod/
  hermes-mod.json
  index.cjs
  package.json        # 可选，有第三方依赖时使用
  node_modules/       # 可选，用户 MOD 自带依赖时使用
```

`hermes-mod.json` 是必需文件，`entry` 指向入口文件。入口建议使用 CommonJS 的 `.cjs`，和现有 MOD 保持一致。

## 最小 manifest

```json
{
  "name": "my-mod",
  "version": "1.0.0",
  "description": "我的 Hermes MOD",
  "author": "your-name",
  "icon": "puzzle",
  "entry": "index.cjs",
  "hermesVersion": ">=0.1.0",
  "permissions": ["panels", "hooks", "ipc", "config"],
  "config": {
    "message": { "type": "string", "default": "Hello", "label": "提示文本" }
  }
}
```

`permissions` 当前可用值：

- `panels`：在侧栏注册面板。
- `hooks`：修改发送给 Agent 的提示或用户消息。
- `ipc`：在主进程注册 MOD 方法，供前端面板调用。
- `config`：使用 MOD 独立配置存储。
- `skills`：向 Agent 暴露技能说明。
- `commands`：声明命令元数据。
- `fs`：MOD 自己需要读写文件时声明。

## 最小入口

```js
// index.cjs
module.exports = {
  panels: {
    sidebar: {
      type: 'info',
      title: '我的 MOD',
      content: 'MOD 已加载',
    },
  },

  hooks: {
    systemPrompt(base) {
      return `${base}\n\n你可以使用 my-mod 提供的能力。`
    },
  },

  main: {
    ipcHandlers: {
      'ping'(_event, args) {
        return { ok: true, args }
      },
    },
  },

  onEnable(ctx) {
    ctx.logger.info('enabled')
    if (ctx.getConfig('message') === undefined) {
      ctx.setConfig('message', 'Hello')
    }
  },

  onDisable(ctx) {
    ctx.logger.info('disabled')
  },
}
```

前端面板可以通过 preload 暴露的通道调用 MOD IPC：

```ts
await window.hermesDesktop.callModIpc('my-mod', 'ping', { text: 'hello' })
```

## 侧栏面板类型

当前桌面端支持以下 `panels.sidebar.type`：

- `info`：通用信息面板，读取 `title` 和 `content`。
- `persona-list`：人格列表面板。
- `todo-list`：任务备忘面板。
- `discipline-board`：自律打卡面板。
- `ssh-manager`：SSH 管理面板。

如果要新增全新的可交互面板类型，需要同时修改桌面端 React 组件映射。

## 配置存储

不要把用户配置写进 MOD 目录。应用会把 MOD 配置保存到用户数据目录：

```text
%APPDATA%\Hermes Desktop Agent\mods\.hermes-mod-config.json
```

在 MOD 中使用 `ctx.getConfig(key)` 和 `ctx.setConfig(key, value)`。这样源码目录、打包资源目录和用户数据目录会保持分离。

## 第三方依赖

内置 MOD 如果需要依赖，优先把依赖加入根目录 `package.json`。例如 `hermes-ssh` 使用的 `ssh2` 已作为主应用依赖安装和打包。

用户 MOD 如果需要依赖，可以在 MOD 自己的目录里保留 `package.json` 并执行：

```powershell
cd "$env:APPDATA\Hermes Desktop Agent\mods\installed\my-mod"
npm install
```

然后在 `index.cjs` 中正常 `require()` 本地依赖。

## 调试流程

源码开发：

```powershell
npm run dev
```

修改 MOD 后，在应用内点击标题栏热重载，或重启应用。左侧“扩展模块”里点击“扫描”可以重新读取 MOD 列表。

Release 调试：

1. 把 MOD 放到 `%APPDATA%\Hermes Desktop Agent\mods\installed\<mod-name>`。
2. 打开应用，进入“扩展模块”。
3. 点击“扫描”。
4. 启用 MOD。
5. 如果加载失败，面板会显示 `hermes-mod.json` 或入口文件的错误信息。

## 注意事项

- MOD 名称必须是单层目录名，不要使用 `/`、`\`、`.` 或 `..`。
- MOD 入口代码运行在 Electron 主进程环境中，能力很强；只安装可信来源的 MOD。
- 原生 Windows 版不再保证 WSL 命令、WSL 路径或 Linux-only 工具存在。
- 需要 Agent 读取的数据，应通过 Hermes native skills 目录或 MOD bridge 同步，不要写到 WSL 的 `~/.hermes`。
