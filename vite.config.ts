import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function localBackendProxy(env: Record<string, string>): Plugin {
  return {
    name: 'delta-local-backend-proxy',
    configureServer(server) {
      server.middlewares.use('/api/backend', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const scriptUrl = env.APPS_SCRIPT_URL
          const secret = env.APPS_SCRIPT_SECRET
          if (!scriptUrl || !secret) {
            res.statusCode = 503
            res.end(JSON.stringify({
              ok: false,
              error: 'Sincronización local no configurada. Creá .env.local con APPS_SCRIPT_URL y APPS_SCRIPT_SECRET. Ver README.'
            }))
            return
          }

          const incoming = new URL(req.url || '/', 'http://localhost')
          let body: any = {}
          if (req.method !== 'GET') {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            const raw = Buffer.concat(chunks).toString('utf8')
            body = raw ? JSON.parse(raw) : {}
          }
          const action = req.method === 'GET' ? (incoming.searchParams.get('action') || 'bootstrap') : String(body.action || '')
          const target = new URL(scriptUrl)
          target.searchParams.set('action', action)
          target.searchParams.set('secret', secret)
          const upstream = await fetch(target, {
            method: req.method === 'GET' ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: req.method === 'GET' ? undefined : JSON.stringify({ ...body, secret }),
            redirect: 'follow'
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.end(text)
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
        }
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      localBackendProxy(env),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['app-icon.svg'],
        manifest: {
          id: '/',
          name: 'DELTA MINING · Registro de Operaciones',
          short_name: 'ROP02 DELTA',
          description: 'Registro offline de operaciones de equipos',
          theme_color: '#0b5d3b',
          background_color: '#f4f7f5',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          orientation: 'portrait',
          icons: [
            { src: '/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
          ]
        },
        workbox: {
          navigateFallback: '/index.html',
          globPatterns: ['**/*.{js,css,html,svg,json}'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.endsWith('/bootstrap.json'),
              handler: 'NetworkFirst',
              options: { cacheName: 'rop02-bootstrap', networkTimeoutSeconds: 3 }
            }
          ]
        }
      })
    ]
  }
})
