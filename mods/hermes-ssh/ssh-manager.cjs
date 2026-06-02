// SSH connection manager — singleton managing multiple server connections
const { Client } = require('ssh2')
const { readFileSync } = require('fs')
const path = require('path')

class SSHManager {
  constructor() {
    this.connections = new Map()  // host:port -> { client, sftp, info }
    this.serverConfigs = []       // persisted server list
  }

  setServerConfigs(servers) {
    this.serverConfigs = servers
  }

  getServerConfigs() {
    return this.serverConfigs.map(s => ({
      host: s.host,
      port: s.port || 22,
      username: s.username,
      name: s.name || `${s.username}@${s.host}`,
      connected: this.connections.has(`${s.host}:${s.port || 22}`),
    }))
  }

  getServerKey(host, port = 22) {
    return `${host}:${port}`
  }

  async connect(host, port = 22, username, auth) {
    const key = this.getServerKey(host, port)
    if (this.connections.has(key)) {
      return { ok: true, message: 'Already connected', key }
    }

    return new Promise((resolve) => {
      const client = new Client()
      const config = {
        host,
        port,
        username,
        readyTimeout: 15000,
        keepaliveInterval: 30000,
      }

      if (auth.password) config.password = auth.password
      if (auth.privateKey) config.privateKey = auth.privateKey
      if (auth.passphrase) config.passphrase = auth.passphrase

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end()
            resolve({ ok: false, error: `SFTP failed: ${err.message}` })
            return
          }
          this.connections.set(key, { client, sftp, info: { host, port, username, connectedAt: Date.now() } })
          resolve({ ok: true, message: 'Connected', key })
        })
      })

      client.on('error', (err) => {
        resolve({ ok: false, error: err.message })
      })

      client.on('close', () => {
        this.connections.delete(key)
      })

      try {
        client.connect(config)
      } catch (err) {
        resolve({ ok: false, error: err.message })
      }
    })
  }

  disconnect(host, port = 22) {
    const key = this.getServerKey(host, port)
    const conn = this.connections.get(key)
    if (!conn) return { ok: false, error: 'Not connected' }
    conn.client.end()
    this.connections.delete(key)
    return { ok: true, message: 'Disconnected' }
  }

  async exec(host, port, command, timeout = 30000) {
    const key = this.getServerKey(host, port)
    const conn = this.connections.get(key)
    if (!conn) return { ok: false, error: 'Not connected to this server' }

    return new Promise((resolve) => {
      conn.client.exec(command, { timeout }, (err, stream) => {
        if (err) { resolve({ ok: false, error: err.message }); return }

        let stdout = ''
        let stderr = ''

        stream.on('data', (data) => { stdout += data.toString() })
        stream.stderr.on('data', (data) => { stderr += data.toString() })
        stream.on('close', (code) => {
          resolve({
            ok: true,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          })
        })
      })
    })
  }

  async listFiles(host, port, remotePath) {
    const key = this.getServerKey(host, port)
    const conn = this.connections.get(key)
    if (!conn || !conn.sftp) return { ok: false, error: 'Not connected' }

    return new Promise((resolve) => {
      conn.sftp.readdir(remotePath || '.', (err, list) => {
        if (err) { resolve({ ok: false, error: err.message }); return }
        resolve({
          ok: true,
          path: remotePath || '.',
          files: list.map(f => ({
            name: f.filename,
            size: f.attrs.size,
            isDir: f.attrs.isDirectory(),
            mode: f.attrs.mode,
            mtime: f.attrs.mtime,
          })).sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1),
        })
      })
    })
  }

  async readFile(host, port, remotePath, encoding = 'utf8') {
    const key = this.getServerKey(host, port)
    const conn = this.connections.get(key)
    if (!conn || !conn.sftp) return { ok: false, error: 'Not connected' }

    return new Promise((resolve) => {
      conn.sftp.readFile(remotePath, { encoding }, (err, data) => {
        if (err) { resolve({ ok: false, error: err.message }); return }
        const MAX = 100000
        const truncated = typeof data === 'string' && data.length > MAX
        resolve({
          ok: true,
          path: remotePath,
          content: truncated ? data.slice(0, MAX) : data,
          size: typeof data === 'string' ? data.length : (Buffer.isBuffer(data) ? data.length : 0),
          truncated,
        })
      })
    })
  }

  async writeFile(host, port, remotePath, content) {
    const key = this.getServerKey(host, port)
    const conn = this.connections.get(key)
    if (!conn || !conn.sftp) return { ok: false, error: 'Not connected' }

    return new Promise((resolve) => {
      conn.sftp.writeFile(remotePath, content, { encoding: 'utf8' }, (err) => {
        if (err) { resolve({ ok: false, error: err.message }); return }
        resolve({ ok: true, message: 'File written', path: remotePath })
      })
    })
  }

  getConnectionStatus() {
    const status = []
    for (const [key, conn] of this.connections) {
      status.push({
        ...conn.info,
        connected: true,
      })
    }
    for (const cfg of this.serverConfigs) {
      const key = this.getServerKey(cfg.host, cfg.port || 22)
      if (!this.connections.has(key)) {
        status.push({
          host: cfg.host,
          port: cfg.port || 22,
          username: cfg.username,
          name: cfg.name,
          connected: false,
        })
      }
    }
    return status
  }

  disconnectAll() {
    for (const [key, conn] of this.connections) {
      conn.client.end()
    }
    this.connections.clear()
  }
}

module.exports = new SSHManager()
