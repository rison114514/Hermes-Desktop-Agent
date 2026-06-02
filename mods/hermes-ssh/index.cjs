// hermes-ssh MOD — remote server management via SSH
const sshManager = require('./ssh-manager.cjs')

function log(...args) { console.log('[hermes-ssh]', ...args) }

const SSH_GUIDANCE = `
## SSH 远程服务器管理能力

你可以通过以下技能直接操控远程服务器。这些技能已在你的工具集中可用。

### 可用工具
- ssh-exec: 在服务器上执行 Shell 命令
- ssh-list: 列出目录内容
- ssh-read: 读取文件内容
- ssh-write: 写入文件
- ssh-status: 查看服务器连接状态

### 基本操作流程

**1. 连接服务器**
用户说"连接到我的服务器"时，调用 ssh-exec 并传递连接命令。如果用户提供了 host/port/username，直接使用；如果未提供，询问用户。
首次连接后，服务器信息会自动保存。

**2. 检查服务器环境**
连接成功后，按以下顺序检查环境：
- ssh-exec: "uname -a" — 操作系统信息
- ssh-exec: "which node python nginx docker 2>/dev/null" — 已安装的工具
- ssh-exec: "df -h /" — 磁盘空间
- ssh-exec: "free -h" — 内存状态
- ssh-exec: "ps aux --sort=-%mem | head -10" — 运行中的进程

**3. 浏览项目文件**
- ssh-list: path="/var/www" 或用户指定的项目路径
- ssh-list: 逐层进入子目录了解项目结构
- ssh-read: 读取关键配置文件（package.json, docker-compose.yml, .env.example 等）

**4. 部署项目**
- 先在本地确认代码正确
- ssh-exec: "cd /path/to/project && git pull" — 拉取最新代码
- ssh-exec: "cd /path/to/project && npm install" — 安装依赖
- ssh-exec: "cd /path/to/project && pm2 restart app" — 重启服务
- ssh-status: 确认部署后服务正常运行

**5. 排查问题**
- ssh-exec: "tail -100 /var/log/nginx/error.log" — 查看错误日志
- ssh-exec: "systemctl status nginx" — 服务状态
- ssh-exec: "docker ps -a" — Docker 容器状态
- ssh-read: 读取应用日志文件

### 注意事项
- 执行长时间命令时提醒用户等待
- 修改文件前先 ssh-read 备份原内容
- 不要在服务器上直接编辑生产配置文件，先 ssh-read → 用户确认 → ssh-write
- 部署前确认 git 状态干净（ssh-exec: "git status"）
`

module.exports = {
  panels: {
    sidebar: {
      type: 'ssh-manager',
      title: 'SSH',
      icon: 'terminal',
    }
  },

  hooks: {
    systemPrompt(base) {
      return base + '\n\n' + SSH_GUIDANCE
    },
  },

  skills: [
    {
      id: 'ssh-exec',
      name: 'ssh-exec',
      description: '在已连接的远程 Linux 服务器上执行任意 Shell 命令并返回 stdout/stderr/exitCode。用于运行脚本、安装软件、重启服务、查看日志、检查系统状态等。参数: host (服务器IP), port (默认22), command (要执行的Shell命令)。',
      category: '远程管理',
      enabled: true,
    },
    {
      id: 'ssh-list',
      name: 'ssh-list',
      description: '列出远程服务器指定目录下的文件和子目录，返回名称/大小/类型/修改时间，目录排在文件前面。用于浏览项目结构、查找配置文件。参数: host, port, path (要列出的目录路径)。',
      category: '远程管理',
      enabled: true,
    },
    {
      id: 'ssh-read',
      name: 'ssh-read',
      description: '读取远程服务器上的文本文件内容（最大100KB，超出自动截断）。用于查看配置文件、日志、源代码。参数: host, port, path (文件完整路径)。',
      category: '远程管理',
      enabled: true,
    },
    {
      id: 'ssh-write',
      name: 'ssh-write',
      description: '将文本内容写入远程服务器的指定文件（覆盖写入）。用于修改配置文件、部署代码、创建脚本。参数: host, port, path (目标文件路径), content (要写入的文本内容)。',
      category: '远程管理',
      enabled: true,
    },
    {
      id: 'ssh-status',
      name: 'ssh-status',
      description: '查看所有已配置服务器的连接状态（是否在线、连接时间）。用于部署前后确认服务器可达。无需参数。',
      category: '远程管理',
      enabled: true,
    },
  ],

  main: {
    ipcHandlers: {
      'connect'(_event, { host, port = 22, username, password, privateKey, passphrase }) {
        return sshManager.connect(host, port, username, { password, privateKey, passphrase })
      },
      'disconnect'(_event, { host, port = 22 }) {
        return sshManager.disconnect(host, port)
      },
      'exec'(_event, { host, port = 22, command, timeout }) {
        return sshManager.exec(host, port, command, timeout)
      },
      'list-files'(_event, { host, port = 22, path: remotePath }) {
        return sshManager.listFiles(host, port, remotePath)
      },
      'read-file'(_event, { host, port = 22, path: remotePath }) {
        return sshManager.readFile(host, port, remotePath)
      },
      'write-file'(_event, { host, port = 22, path: remotePath, content }) {
        return sshManager.writeFile(host, port, remotePath, content)
      },
      'status'() {
        return sshManager.getConnectionStatus()
      },
      'add-server'(_event, serverConfig) {
        const servers = sshManager.getServerConfigs()
        servers.push(serverConfig)
        sshManager.setServerConfigs(servers)
        return { ok: true, servers: sshManager.getServerConfigs() }
      },
      'remove-server'(_event, { host, port = 22 }) {
        sshManager.disconnect(host, port)
        const servers = sshManager.getServerConfigs().filter(s =>
          !(s.host === host && (s.port || 22) === port)
        )
        sshManager.setServerConfigs(servers)
        return { ok: true, servers: sshManager.getServerConfigs() }
      },
    },
  },

  onEnable(ctx) {
    log('SSH MOD enabled')
    const saved = ctx.getConfig('servers')
    if (saved) {
      try {
        sshManager.setServerConfigs(JSON.parse(saved))
        log('Loaded', sshManager.getServerConfigs().length, 'server configs')
      } catch {
        sshManager.setServerConfigs([])
      }
    }
  },

  onDisable() {
    log('SSH MOD disabled — disconnecting all servers')
    sshManager.disconnectAll()
  },

  defaultConfig: {
    servers: '[]',
  },
}
