import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

// La app muestra las validaciones dentro del formulario. Evitamos los popups
// nativos del navegador para no interrumpir al operador.
window.alert = () => undefined

function selectEquipmentFromQr() {
  const interno = new URLSearchParams(window.location.search).get('interno')?.trim().toUpperCase()
  if (!interno) return

  let attempts = 0
  const maxAttempts = 100
  const timer = window.setInterval(() => {
    attempts++

    const labels = Array.from(document.querySelectorAll('label'))
    const internoLabel = labels.find(label => label.textContent?.trim().startsWith('Interno *'))
    const select = internoLabel?.querySelector('select') as HTMLSelectElement | null

    if (select && Array.from(select.options).some(option => option.value === interno)) {
      if (select.value !== interno) {
        select.value = interno
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      window.clearInterval(timer)
      return
    }

    if (attempts >= maxAttempts) {
      window.clearInterval(timer)
      console.warn(`No se encontró el equipo indicado por QR: ${interno}`)
    }
  }, 150)
}

registerSW({ immediate: true })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
selectEquipmentFromQr()
