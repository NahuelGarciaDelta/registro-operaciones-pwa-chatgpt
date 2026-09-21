export default async function handler(req: any, res: any) {
  const url = process.env.APPS_SCRIPT_URL
  const secret = process.env.APPS_SCRIPT_SECRET
  if (!url || !secret) return res.status(503).json({ ok: false, error: 'Backend no configurado: faltan APPS_SCRIPT_URL/APPS_SCRIPT_SECRET' })
  try {
    const action = req.method === 'GET' ? String(req.query.action || 'bootstrap') : String(req.body?.action || '')
    const target = new URL(url)
    target.searchParams.set('action', action)
    target.searchParams.set('secret', secret)
    const r = await fetch(target, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : JSON.stringify({ ...req.body, secret }),
      redirect: 'follow'
    })
    const text = await r.text()
    res.status(r.status).setHeader('Content-Type', 'application/json; charset=utf-8').send(text)
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
