import { HermesBridge } from './hermes-bridge.js'

export interface SessionInfo {
  id: string
  name: string
  cwd: string
  title: string | null
  bridge: HermesBridge
}

type CreateSessionOptions = {
  configureBridge?: (bridge: HermesBridge, sessionId: string) => void
}

class SessionManager {
  private sessions = new Map<string, SessionInfo>()
  private activeId: string | null = null

  get activeSession(): SessionInfo | null {
    return this.activeId ? this.sessions.get(this.activeId) ?? null : null
  }

  getActiveId(): string | null {
    return this.activeId
  }

  get activeBridge(): HermesBridge | null {
    return this.activeSession?.bridge ?? null
  }

  getActiveBridge(): HermesBridge | null {
    return this.activeBridge
  }

  getSession(id: string): SessionInfo | null {
    return this.sessions.get(id) ?? null
  }

  listSessions(): { id: string; name: string; cwd: string }[] {
    return [...this.sessions.values()].map((s) => ({ id: s.id, name: s.name, cwd: s.cwd }))
  }

  registerSession(id: string, name: string, cwd: string, bridge: HermesBridge) {
    this.sessions.set(id, { id, name, cwd, title: null, bridge })
    if (!this.activeId) this.activeId = id
  }

  updateSession(id: string, patch: Partial<Pick<SessionInfo, 'cwd' | 'title' | 'name'>>) {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.set(id, { ...session, ...patch })
  }

  updateActive(patch: Partial<Pick<SessionInfo, 'cwd' | 'title' | 'name'>>) {
    if (this.activeId) this.updateSession(this.activeId, patch)
  }

  setActive(id: string): boolean {
    if (this.sessions.has(id)) {
      this.activeId = id
      return true
    }
    return false
  }

  async createSession(name: string, cwd?: string, options?: CreateSessionOptions): Promise<SessionInfo> {
    const bridge = new HermesBridge()
    // Generate a tab id immediately. The caller decides whether this tab should
    // start a fresh ACP session or load an existing one; doing it here races
    // with those explicit actions.
    const id = `session-${Date.now()}`
    const info: SessionInfo = { id, name, cwd: cwd ?? process.cwd(), title: null, bridge }
    bridge.initWorkspacePath(info.cwd)
    options?.configureBridge?.(bridge, id)
    this.sessions.set(id, info)
    if (!this.activeId) this.activeId = id

    return info
  }

  async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) return false
    session.bridge.stop()
    this.sessions.delete(id)
    if (this.activeId === id) {
      this.activeId = this.sessions.keys().next().value ?? null
    }
    return true
  }

  closeAll() {
    for (const [, session] of this.sessions) {
      session.bridge.stop()
    }
    this.sessions.clear()
    this.activeId = null
  }
}

export const sessionManager = new SessionManager()
