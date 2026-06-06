// hermes-todo MOD — task memo with AI read/write support
let tasks = []
let _ctx = null

function loadTasks() {
  try {
    const raw = _ctx ? _ctx.getConfig('tasks') : null
    tasks = raw ? JSON.parse(raw) : []
  } catch {
    tasks = []
  }
}

function saveTasks() {
  if (_ctx) _ctx.setConfig('tasks', JSON.stringify(tasks))
}

module.exports = {
  panels: {
    sidebar: { type: 'todo-list', title: '任务备忘', icon: 'check' }
  },

  skills: [
    { id: 'todo-list', name: 'todo-list', description: '列出所有备忘录任务及完成状态。显示序号和状态。', category: '备忘', enabled: true },
    { id: 'todo-add', name: 'todo-add', description: '添加新任务到备忘录。参数: title (任务标题)', category: '备忘', enabled: true },
    { id: 'todo-done', name: 'todo-done', description: '标记任务为已完成。参数: index (任务序号，从0开始)', category: '备忘', enabled: true },
    { id: 'todo-undo', name: 'todo-undo', description: '将已完成任务恢复为未完成。参数: index', category: '备忘', enabled: true },
    { id: 'todo-remove', name: 'todo-remove', description: '删除指定任务。参数: index', category: '备忘', enabled: true },
    { id: 'todo-clear', name: 'todo-clear', description: '清空所有已完成的任务', category: '备忘', enabled: true },
  ],

  main: {
    ipcHandlers: {
      'list'() {
        return tasks.map((t, i) => ({ index: i, ...t }))
      },
      'add'(_e, { title, detail, urgency, importance, ddl }) {
        if (!title || !title.trim()) return { ok: false, error: 'title is required' }
        tasks.push({
          title: title.trim(), detail: detail || '', urgency: urgency || 'medium',
          importance: importance || 'medium', ddl: ddl || null, done: false, createdAt: Date.now(),
        })
        saveTasks()
        return { ok: true, tasks: tasks.map((t, i) => ({ index: i, ...t })) }
      },
      'update'(_e, { index, title, detail, urgency, importance, ddl }) {
        const i = Number(index)
        if (isNaN(i) || i < 0 || i >= tasks.length) return { ok: false, error: 'invalid index' }
        if (title !== undefined) tasks[i].title = title.trim()
        if (detail !== undefined) tasks[i].detail = detail
        if (urgency !== undefined) tasks[i].urgency = urgency
        if (importance !== undefined) tasks[i].importance = importance
        if (ddl !== undefined) tasks[i].ddl = ddl || null
        saveTasks()
        return { ok: true, task: { index: i, ...tasks[i] } }
      },
      'toggle'(_e, { index }) {
        const i = Number(index)
        if (isNaN(i) || i < 0 || i >= tasks.length) return { ok: false, error: 'invalid index' }
        tasks[i].done = !tasks[i].done
        saveTasks()
        return { ok: true, task: { index: i, ...tasks[i] } }
      },
      'remove'(_e, { index }) {
        const i = Number(index)
        if (isNaN(i) || i < 0 || i >= tasks.length) return { ok: false, error: 'invalid index' }
        tasks.splice(i, 1)
        saveTasks()
        return { ok: true, tasks: tasks.map((t, idx) => ({ index: idx, ...t })) }
      },
      'clear-done'() {
        tasks = tasks.filter(t => !t.done)
        saveTasks()
        return { ok: true, tasks: tasks.map((t, i) => ({ index: i, ...t })) }
      },
    },
  },

  onEnable(ctx) {
    _ctx = ctx
    loadTasks()
    console.log('[hermes-todo] enabled,', tasks.length, 'tasks loaded')
  },

  onDisable() {
    saveTasks()
    _ctx = null
    console.log('[hermes-todo] disabled')
  },
}
