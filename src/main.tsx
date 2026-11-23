import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'

if (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches) {
  document.documentElement.classList.add('touch-device')
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
