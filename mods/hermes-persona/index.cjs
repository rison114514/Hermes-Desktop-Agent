// hermes-persona MOD — 多套人格模板，消息注入式切换

const path = require('path')
const fs = require('fs')

function loadPersonas(modDir) {
  const dir = path.join(modDir, 'personas')
  const list = []
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      try {
        const raw = fs.readFileSync(path.join(dir, entry), 'utf8')
        list.push(JSON.parse(raw))
      } catch { /* skip */ }
    }
  } catch { /* no personas dir */ }
  return list
}

function getPersonaPath(modDir, id) {
  const dir = path.join(modDir, 'personas')
  return path.join(dir, `${id}.json`)
}

function savePersona(modDir, detail) {
  if (!detail || !detail.id) return { ok: false, error: '人格 id 不能为空' }
  const existing = personas.find(p => p.id === detail.id)
  if (!existing) return { ok: false, error: '未找到人格' }
  const next = {
    ...existing,
    name: String(detail.name || existing.name || ''),
    icon: String(detail.icon || existing.icon || 'bot'),
    description: String(detail.description || ''),
    activation: String(detail.activation || ''),
    id: existing.id,
  }
  fs.writeFileSync(getPersonaPath(modDir, existing.id), JSON.stringify(next, null, 2), 'utf8')
  personas = loadPersonas(modDir)
  return { ok: true, persona: next }
}

// Store personas for use in hooks — populated in onEnable
let personas = []
let currentId = null
let currentModDir = __dirname

module.exports = {
  tabs: [
    {
      id: 'persona-editor',
      title: '人格编辑',
      rendererType: 'persona-editor',
      icon: 'bot',
    },
  ],

  panels: {
    sidebar: {
      type: 'persona-list',
      title: '人格',
      emptyText: '未找到人格定义',
    }
  },

  hooks: {
    onUserMessage(text) {
      if (!currentId) return text
      const persona = personas.find(p => p.id === currentId)
      if (!persona) return text
      return `${persona.activation}\n\n---\n${text}`
    }
  },

  onEnable(ctx) {
    currentModDir = ctx.modDir || path.join(__dirname)
    personas = loadPersonas(currentModDir)
    // Restore last active persona from config
    const saved = ctx.getConfig('activePersona')
    if (saved && personas.some(p => p.id === saved)) {
      currentId = saved
    }
    console.log('[hermes-persona] enabled,', personas.length, 'personas loaded, active:', currentId || 'none')
  },

  onDisable() {
    currentId = null
    personas = []
  },

  defaultConfig: {
    activePersona: '',
  },

  // Internal API called by renderer to switch persona
  setActivePersona(id) {
    currentId = id || null
  },

  getPersonas() {
    return personas.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      description: p.description,
      active: p.id === currentId,
    }))
  },

  getActivePersona() {
    return currentId
  },

  main: {
    ipcHandlers: {
      'get-persona-detail'(_event, { id }) {
        const persona = personas.find(p => p.id === id)
        return persona ? { ok: true, persona } : { ok: false, error: '未找到人格' }
      },
      'save-persona'(_event, { persona }) {
        return savePersona(currentModDir, persona)
      },
    },
  },
}
