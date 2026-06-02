// hello-world MOD — demonstrates the Hermes MOD descriptor interface
// Panels use plain objects (serializable over IPC), rendered by ModPanel
// Hooks & lifecycle run in the main process

export default {
  // Sidebar panel — plain descriptor object rendered by ModPanel component
  panels: {
    sidebar: {
      type: 'info',
      title: 'Hello World',
      content: 'Hello World MOD is active!',
      icon: 'smile',
    }
  },

  // Lifecycle hooks
  onEnable(ctx) {
    console.log('[hello-world] MOD enabled')
    console.log('[hello-world] greeting config:', ctx.getConfig('greeting'))
  },

  onDisable(ctx) {
    console.log('[hello-world] MOD disabled')
  },

  // Message hooks (registered in main process, invoked by chat pipeline)
  hooks: {
    // Prepend a tag to user messages before they reach Hermes
    onUserMessage(text) {
      return `[HelloWorld] ${text}`
    }
  },

  // Default config values (schema declared in hermes-mod.json)
  defaultConfig: {
    greeting: 'Hello from MOD!',
  }
}
