// hermes-discipline MOD — 自律打卡展板
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs')
const path = require('path')

function getDataPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
  return path.join(localAppData, 'hermes', 'skills', 'discipline', 'discipline-plans.json')
}

const DEFAULT_WEEKDAY_SCHEDULE = [
  { timeSlot: '08:00-09:00', title: '晨间规划' },
  { timeSlot: '09:00-12:00', title: '深度工作' },
  { timeSlot: '12:00-13:00', title: '午餐休息' },
  { timeSlot: '13:00-17:00', title: '下午工作' },
  { timeSlot: '17:00-18:00', title: '锻炼' },
  { timeSlot: '20:00-22:00', title: '学习/阅读' },
]

const DEFAULT_WEEKEND_SCHEDULE = [
  { timeSlot: '09:00-10:00', title: '晨读' },
  { timeSlot: '10:00-12:00', title: '兴趣爱好' },
  { timeSlot: '14:00-17:00', title: '自由安排' },
  { timeSlot: '20:00-22:00', title: '复盘总结' },
]

const DEFAULT_GOALS = [
  { title: '专注工作 4 小时' },
  { title: '阅读 30 分钟' },
  { title: '运动 30 分钟' },
]

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

let plans = []
let templates = []

function loadData() {
  try {
    const p = getDataPath()
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8')
      const data = JSON.parse(raw)
      plans = data.plans || []
      templates = data.templates || []
    }
  } catch (err) {
    console.warn('[hermes-discipline] load failed:', err.message)
    plans = []
    templates = []
  }
}

function saveData() {
  try {
    const p = getDataPath()
    const dir = path.dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, JSON.stringify({ plans, templates }, null, 2), 'utf8')
  } catch (err) {
    console.warn('[hermes-discipline] save failed:', err.message)
  }
}

function initTemplates() {
  if (templates.length === 0) {
    templates = [
      { id: 'weekday', name: '工作日', schedule: DEFAULT_WEEKDAY_SCHEDULE, dailyGoals: DEFAULT_GOALS, weekdayTargets: [1, 2, 3, 4, 5] },
      { id: 'weekend', name: '周末', schedule: DEFAULT_WEEKEND_SCHEDULE, dailyGoals: DEFAULT_GOALS, weekdayTargets: [0, 6] },
    ]
    saveData()
  }
  // Migrate old templates that lack weekdayTargets
  let migrated = false
  templates.forEach(t => {
    if (!t.weekdayTargets) {
      if (t.id === 'weekday') t.weekdayTargets = [1, 2, 3, 4, 5]
      else if (t.id === 'weekend') t.weekdayTargets = [0, 6]
      else t.weekdayTargets = []
      migrated = true
    }
  })
  if (migrated) saveData()
}

function getDayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay()
}

function findBestTemplate(dateStr) {
  const dow = getDayOfWeek(dateStr)
  // First try exact weekdayTargets match
  const exact = templates.find(t => t.weekdayTargets && t.weekdayTargets.includes(dow))
  if (exact) return exact
  // Fallback to dayType
  const isWeekend = (dow === 0 || dow === 6)
  return templates.find(t => t.id === (isWeekend ? 'weekend' : 'weekday')) || templates[0]
}

function getOrCreatePlan(date) {
  let plan = plans.find(p => p.date === date)
  if (!plan) {
    const tmpl = findBestTemplate(date) || { schedule: [], dailyGoals: [] }
    plan = {
      date,
      dayType: ([0, 6].includes(getDayOfWeek(date))) ? 'weekend' : 'weekday',
      schedule: (tmpl.schedule || []).map(s => ({
        timeSlot: s.timeSlot,
        title: s.title,
        status: 'pending',
        description: '',
      })),
      dailyGoals: (tmpl.dailyGoals || []).map(g => ({
        title: g.title,
        status: 'pending',
        description: '',
      })),
      aiSummary: null,
      aiSummaryRequested: false,
    }
    plans.push(plan)
    saveData()
  }
  return plan
}

// Apply a template's schedule+goals to a specific date (overwrites existing)
function applyTemplateToDate(date, tmpl) {
  const idx = plans.findIndex(p => p.date === date)
  const plan = {
    date,
    dayType: ([0, 6].includes(getDayOfWeek(date))) ? 'weekend' : 'weekday',
    schedule: (tmpl.schedule || []).map(s => ({
      timeSlot: s.timeSlot,
      title: s.title,
      status: 'pending',
      description: '',
    })),
    dailyGoals: (tmpl.dailyGoals || []).map(g => ({
      title: g.title,
      status: 'pending',
      description: '',
    })),
    aiSummary: null,
    aiSummaryRequested: false,
  }
  if (idx >= 0) {
    // Preserve existing status/descriptions if possible
    const old = plans[idx]
    plan.schedule = plan.schedule.map((s, i) => {
      const oldSlot = old.schedule[i]
      if (oldSlot && oldSlot.timeSlot === s.timeSlot) {
        return { ...s, status: oldSlot.status, description: oldSlot.description }
      }
      return s
    })
    plan.dailyGoals = plan.dailyGoals.map((g, i) => {
      const oldGoal = old.dailyGoals[i]
      if (oldGoal && oldGoal.title === g.title) {
        return { ...g, status: oldGoal.status, description: oldGoal.description }
      }
      return g
    })
    plan.aiSummary = old.aiSummary
    plans[idx] = plan
  } else {
    plans.push(plan)
  }
  return plan
}

module.exports = {
  panels: {
    sidebar: { type: 'discipline-board', title: '自律打卡', icon: 'calendar' },
  },

  main: {
    ipcHandlers: {
      'get-plan'(_e, { date }) {
        const plan = getOrCreatePlan(date)
        return { ok: true, plan, templates }
      },

      'get-plans-batch'(_e, { dates }) {
        const result = {}
        for (const d of dates) {
          result[d] = getOrCreatePlan(d)
        }
        return { ok: true, plans: result, templates }
      },

      'list-plans'() {
        return { ok: true, plans, templates }
      },

      'save-plan'(_e, { date, plan }) {
        const idx = plans.findIndex(p => p.date === date)
        if (idx >= 0) {
          plans[idx] = { ...plans[idx], ...plan, date }
        } else {
          plans.push({ ...plan, date })
        }
        saveData()
        return { ok: true, plan: plans[idx >= 0 ? idx : plans.length - 1] }
      },

      'update-schedule'(_e, { date, index, status, description, title, timeSlot }) {
        const plan = plans.find(p => p.date === date)
        if (!plan) return { ok: false, error: 'plan not found' }
        const i = Number(index)
        if (isNaN(i) || i < 0 || i >= plan.schedule.length) return { ok: false, error: 'invalid index' }
        if (status !== undefined) plan.schedule[i].status = status
        if (description !== undefined) plan.schedule[i].description = description
        if (title !== undefined) plan.schedule[i].title = title
        if (timeSlot !== undefined) plan.schedule[i].timeSlot = timeSlot
        saveData()
        return { ok: true, plan }
      },

      'update-goal'(_e, { date, index, status, description, title }) {
        const plan = plans.find(p => p.date === date)
        if (!plan) return { ok: false, error: 'plan not found' }
        const i = Number(index)
        if (isNaN(i) || i < 0 || i >= plan.dailyGoals.length) return { ok: false, error: 'invalid index' }
        if (status !== undefined) plan.dailyGoals[i].status = status
        if (description !== undefined) plan.dailyGoals[i].description = description
        if (title !== undefined) plan.dailyGoals[i].title = title
        saveData()
        return { ok: true, plan }
      },

      'request-summary'(_e, { date }) {
        const plan = plans.find(p => p.date === date)
        if (!plan) return { ok: false, error: 'plan not found' }
        plan.aiSummaryRequested = true
        saveData()
        return { ok: true, plan }
      },

      'save-summary'(_e, { date, score, color, text }) {
        const plan = plans.find(p => p.date === date)
        if (!plan) return { ok: false, error: 'plan not found' }
        plan.aiSummary = { score, color, text, createdAt: Date.now() }
        plan.aiSummaryRequested = false
        saveData()
        return { ok: true, plan }
      },

      'get-templates'() {
        return { ok: true, templates }
      },

      'save-template'(_e, { template }) {
        const idx = templates.findIndex(t => t.id === template.id)
        if (idx >= 0) {
          templates[idx] = template
        } else {
          templates.push(template)
        }
        saveData()
        return { ok: true, templates }
      },

      'delete-template'(_e, { id }) {
        templates = templates.filter(t => t.id !== id)
        saveData()
        return { ok: true, templates }
      },

      // Apply a template to one or more dates
      'apply-template'(_e, { templateId, dates }) {
        const tmpl = templates.find(t => t.id === templateId)
        if (!tmpl) return { ok: false, error: 'template not found' }
        const results = []
        for (const date of dates) {
          results.push(applyTemplateToDate(date, tmpl))
        }
        saveData()
        return { ok: true, plans: results }
      },
    },
  },

  onEnable() {
    loadData()
    initTemplates()
    console.log('[hermes-discipline] enabled,', plans.length, 'plans,', templates.length, 'templates')
  },

  onDisable() {
    saveData()
    console.log('[hermes-discipline] disabled')
  },
}
