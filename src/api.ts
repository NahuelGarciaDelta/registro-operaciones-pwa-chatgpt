import type { BootstrapData, PendingRecord, Rop02Record } from './types'

const base = import.meta.env.VITE_BACKEND_URL || '/api/backend'
const CREATE_TIMEOUT_MS = 20000
const CHECK_TIMEOUT_MS = 12000

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('La sincronización tardó demasiado y se interrumpió la espera de respuesta.')
    }
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

async function jsonOrThrow(r: Response) {
  const text = await r.text()
  let data: any
  try { data = JSON.parse(text) }
  catch {
    if (!r.ok) throw new Error(`Backend no disponible (HTTP ${r.status}). En desarrollo local configurá APPS_SCRIPT_URL y APPS_SCRIPT_SECRET en .env.local.`)
    throw new Error('El backend devolvió una respuesta inválida.')
  }
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
  if (data?.ok === false) throw new Error(data.error || 'Error del backend')
  return data
}

export async function getBootstrap(): Promise<BootstrapData> {
  try {
    const r = await fetchWithTimeout(`${base}?action=bootstrap`, { cache: 'no-store' }, CHECK_TIMEOUT_MS)
    const data = await jsonOrThrow(r)
    return data
  } catch {
    const r = await fetch(`/bootstrap.json?v=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) throw new Error('No se pudieron cargar las listas de la planilla ni el respaldo local.')
    return await r.json()
  }
}

export async function createRecord(item: PendingRecord): Promise<Rop02Record> {
  const r = await fetchWithTimeout(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createRecord', id: item.id, payload: item.payload, signatureDataUrl: item.signatureDataUrl })
  }, CREATE_TIMEOUT_MS)
  const data = await jsonOrThrow(r)
  if (!data.record) throw new Error('El backend no devolvió el registro sincronizado.')
  return data.record
}

export async function checkRecord(id: string): Promise<Rop02Record | null> {
  const r = await fetchWithTimeout(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'checkRecord', id })
  }, CHECK_TIMEOUT_MS)
  const data = await jsonOrThrow(r)
  return data.found && data.record ? data.record : null
}
