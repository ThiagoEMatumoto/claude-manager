import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './index.css'

// Warm-up da fonte do terminal: dispara o fetch da woff2 já no boot do renderer,
// minimizando a espera do gate de open do Terminal (que aguarda a fonte pra
// medir as células com a família certa).
void document.fonts.load('16px "JetBrains Mono"')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
