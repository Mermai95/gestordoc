import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Reset CSS mínimo
const style = document.createElement('style')
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: #F5F3EE; color: #1C1C1C; -webkit-font-smoothing: antialiased; }
  button { font-family: inherit; }
  input, textarea, select { font-family: inherit; }
  a { text-decoration: none; }
`
document.head.appendChild(style)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
