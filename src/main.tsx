import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app'
import { TodoWidget } from './components/TodoWidget'
import 'katex/dist/katex.min.css'
import './styles.css'

// A dedicated always-on-top window loads the same bundle with a '#todo-widget'
// hash; mount only the compact memo widget there instead of the full app.
const isTodoWidget = window.location.hash.replace(/^#/, '') === 'todo-widget'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTodoWidget ? <TodoWidget /> : <App />}
  </React.StrictMode>,
)
