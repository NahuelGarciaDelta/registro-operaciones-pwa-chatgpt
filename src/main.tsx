import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'
import './brand.css'

// Convierte el deep-link robusto del QR (hash) a los parámetros que consume App.tsx.
// Usamos hash porque no se envía al servidor y sobrevive mejor a aperturas PWA/offline.
// Formato soportado: #/equipo/JM/RPC-0016-JM o #/equipo/FS/PCA-0093
function hydrateQrDeepLinkFromHash() {
  try {
    const rawHash = window.location.hash || ''
    const match = rawHash.match(/^#\/equipo\/(JM|FS|FDS|JOSE%20MARIA|FILO%20DEL%20SOL)\/([^/?#]+)$/i)
    if (!match) return

    const projectToken = decodeURIComponent(match[1]).trim().toUpperCase()
    const interno = decodeURIComponent(match[2]).trim().toUpperCase()
    if (!interno) return

    const proyecto = projectToken === 'JM' || projectToken === 'JOSE MARIA'
      ? 'JOSE MARIA'
      : 'FILO DEL SOL'

    const url = new URL(window.location.href)
    if (!url.searchParams.get('interno')) url.searchParams.set('interno', interno)
    if (!url.searchParams.get('proyecto')) url.searchParams.set('proyecto', proyecto)

    // El App ya lee searchParams. Quitamos el hash después de hidratar para evitar
    // que quede un estado visual raro al recargar o al volver desde otra pantalla.
    url.hash = ''
    window.history.replaceState(null, '', url.pathname + url.search)
  } catch {
    // Si el QR estuviera mal formado, App.tsx seguirá abriendo normalmente.
  }
}

hydrateQrDeepLinkFromHash()

// La app muestra las validaciones dentro del formulario. Evitamos los popups
// nativos del navegador para no interrumpir al operador.
window.alert = () => undefined

registerSW({ immediate: true })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
