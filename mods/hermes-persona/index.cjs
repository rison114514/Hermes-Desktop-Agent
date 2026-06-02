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

// Store personas for use in hooks — populated in onEnable
let personas = []
let currentId = null

module.exports = {
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
    personas = loadPersonas(ctx.modDir || path.join(__dirname))
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
}
