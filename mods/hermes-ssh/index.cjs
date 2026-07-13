// hermes-ssh MOD — remote server management via SSH
const sshManager = require('./ssh-manager.cjs')

function log(...args) { console.log('[hermes-ssh]', ...args) }

module.exports = {
  tabs: [
    {
      id: 'ssh-manager',
      title: 'SSH 管理',
      rendererType: 'ssh-manager',
      icon: 'terminal',
    },
  ],

  panels: {
    sidebar: {
      type: 'ssh-manager',
      title: 'SSH',
      icon: 'terminal',
    }
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
      'get-configs'() {
        return sshManager.getServerConfigs()
      },
      'add-server'(_event, { server }) {
        const servers = sshManager.getServerConfigs()
        // Replace existing config for same host:port
        const idx = servers.findIndex(s => s.host === server.host && (s.port || 22) === (server.port || 22))
        if (idx >= 0) servers[idx] = server
        else servers.push(server)
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
