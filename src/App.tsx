import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { checkRecord, createRecord, getBootstrap } from './api'
import { db } from './db'
import { calcHours, estadoTexto, provisionalReference, tasksForEquipment } from './lib/business'
import SignaturePad from './components/SignaturePad'
import type { BootstrapData, EstadoEquipo, PendingRecord, Rop02Record } from './types'

const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/San_Juan', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date())

const schema = z.object({
  Fecha: z.string().min(1),
  Interno: z.string().min(1),
  Equipo: z.string().min(1),
  Operador: z.string().min(1),
  'Supervisor Delta': z.string().min(1),
  'Supervisor Vial Cliente': z.string().min(1),
  'Turno de trabajo': z.string().min(1),
  'N° Parte': z.number().int(),
  Proyecto: z.enum(['JOSE MARIA', 'FILO DEL SOL']),
  'Area de trabajo': z.string().min(1),
  'Horómetro inicial': z.number().int(),
  'Horómetro final': z.number().int(),
  'Cambio de tareas planificadas': z.string().trim().min(1),
  'Información sobre Desgaste': z.string().trim().min(1),
  Combustible: z.string().trim().min(1),
  Aceite: z.string().trim().min(1),
  'Tarea 1': z.string().trim().min(1),
  'Observaciones 1': z.string().trim().min(1)
})

const blank = (project = 'JOSE MARIA'): Rop02Record => ({
  ID: crypto.randomUUID(), Fecha: today(), Interno: '', Equipo: '', Operador: '',
  'Supervisor Delta': '', 'Supervisor Vial Cliente': '', 'Turno de trabajo': 'TURNO DIA',
  'N° Parte': null, Proyecto: project, 'Area de trabajo': 'Camino',
  'Horómetro inicial': null, 'Horómetro final': null, 'Cant. Hs.': null, 'OD o FS': '',
  Combustible: 'Sin carga', Aceite: 'Sin carga', 'Tarea 1': '', 'Tarea 2': '',
  'Información sobre Desgaste': 'Sin consumos de desgaste', 'Observaciones 1': '',
  'Observaciones 2': '', 'Cambio de tareas planificadas': 'Sin cambio de tareas planificadas'
})

const receiptCode = (id: string, interno: string, parte: number | null) => {
  const shortId = id.replace(/-/g, '').slice(0, 6).toUpperCase()
  const compactInternal = interno.replace(/[^A-Za-z0-9]/g, '')
  return `ROP02-${compactInternal}-${parte ?? 'SREF'}-${shortId}`
}

const formatDateTime = (iso: string) => {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/San_Juan',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function App() {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [form, setForm] = useState<Rop02Record>(blank())
  const [sig, setSig] = useState<string>()
  const [pending, setPending] = useState<PendingRecord[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<'form' | 'pending' | 'receipts'>('form')
  const [syncing, setSyncing] = useState(false)
  const syncInFlight = useRef(false)

  const reloadPending = async () => setPending(await db.syncQueue.orderBy('createdAt').toArray())

  const sync = useCallback(async (showResult = false) => {
    if (!navigator.onLine) {
      if (showResult) setMsg('No hay conexión. Las cargas siguen guardadas en el dispositivo.')
      return
    }
    if (syncInFlight.current) {
      if (showResult) setMsg('Ya hay una sincronización en curso.')
      return
    }

    syncInFlight.current = true
    setSyncing(true)
    let ok = 0
    let errors = 0
    let lastError = ''

    try {
      const q = await db.syncQueue.orderBy('createdAt').toArray()
      for (const item of q) {
        try {
          const now = new Date().toISOString()
          await db.syncQueue.update(item.id, {
            syncStatus: 'syncing',
            syncAttempts: item.syncAttempts + 1,
            lastSyncError: undefined,
            updatedAt: now
          })
          await reloadPending()

          let definitive: Rop02Record
          try {
            definitive = await createRecord(item)
          } catch (createError) {
            const recovered = await checkRecord(item.id).catch(() => null)
            if (!recovered) throw createError
            definitive = recovered
          }

          // Una carga confirmada por Sheets pasa a Comprobantes antes de salir de Pendientes.
          await db.syncedRecords.put({
            id: item.id,
            payload: definitive,
            syncedAt: new Date().toISOString()
          })
          await db.syncQueue.delete(item.id)
          ok++
        } catch (e) {
          errors++
          lastError = e instanceof Error ? e.message : String(e)
          await db.syncQueue.update(item.id, {
            syncStatus: 'error',
            lastSyncError: lastError,
            updatedAt: new Date().toISOString()
          })
        } finally {
          await reloadPending()
        }
      }

      if (ok > 0) {
        try {
          const fresh = await getBootstrap()
          setData(fresh)
          await db.catalogs.put({ key: 'bootstrap', value: fresh })
        } catch { /* la carga ya quedó sincronizada; se refrescará después */ }
      }
    } finally {
      syncInFlight.current = false
      setSyncing(false)
      await reloadPending()
    }

    if (showResult) {
      if (errors) setMsg(`No se pudo sincronizar ${errors} carga(s). ${lastError}`)
      else if (ok) setMsg(`${ok} carga(s) sincronizada(s) correctamente. El comprobante quedó disponible.`)
      else setMsg('No hay cargas pendientes de sincronización.')
    }
  }, [])

  const load = useCallback(async (showResult = false) => {
    try {
      const fresh = await getBootstrap()
      setData(fresh)
      await db.catalogs.put({ key: 'bootstrap', value: fresh })
      setForm(f => ({ ...f, Proyecto: ['JOSE MARIA', 'FILO DEL SOL'].includes(f.Proyecto) ? f.Proyecto : 'JOSE MARIA' }))
      if (showResult) setMsg('Listas actualizadas desde la fuente de datos.')
    } catch (e) {
      const cached = await db.catalogs.get('bootstrap')
      if (cached) {
        setData(cached.value)
        if (showResult) setMsg('Sin conexión al backend. Se mantienen las listas guardadas en el dispositivo.')
      } else if (showResult) {
        setMsg(e instanceof Error ? e.message : 'No se pudieron actualizar las listas.')
      }
    }
    await reloadPending()
  }, [])

  useEffect(() => {
    load()
    const on = () => { setOnline(true); sync() }
    const off = () => setOnline(false)
    addEventListener('online', on)
    addEventListener('offline', off)
    return () => { removeEventListener('online', on); removeEventListener('offline', off) }
  }, [load, sync])

  useEffect(() => {
    const id = setInterval(() => { if (navigator.onLine) sync() }, 30000)
    return () => clearInterval(id)
  }, [sync])

  const equipment = useMemo(() => data?.equipos.find(e => e.id === form.Interno), [data, form.Interno])
  const tasks = useMemo(() => tasksForEquipment(data?.tareas || [], form.Equipo), [data, form.Equipo])
  const hfTooLow = form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro final'] < form['Horómetro inicial']
  const set = (k: keyof Rop02Record, v: any) => setForm(f => ({ ...f, [k]: v }))

  const chooseInterno = (v: string) => {
    if (!data) return
    const eq = data.equipos.find(e => e.id === v)
    const ref = provisionalReference(v, data.equipmentState, pending)
    setForm(f => ({
      ...f, Interno: v, Equipo: eq?.equipo || '', 'N° Parte': ref.parte,
      'Horómetro inicial': ref.hi, 'Horómetro final': null, 'Cant. Hs.': null,
      'Tarea 1': '', 'Tarea 2': '', 'Observaciones 1': '', 'Observaciones 2': '', 'OD o FS': ''
    }))
  }

  const chooseEstado = (v: EstadoEquipo) => {
    const text = estadoTexto(v)
    setForm(f => ({
      ...f, 'OD o FS': v, 'Tarea 1': text || '', 'Observaciones 1': text || '', 'Tarea 2': '',
      'Observaciones 2': '', 'Cant. Hs.': calcHours(f['Horómetro inicial'], f['Horómetro final']),
      Combustible: v ? 'Sin carga' : f.Combustible, Aceite: v ? 'Sin carga' : f.Aceite
    }))
  }

  const changeHorometroFinal = (raw: string) => {
    if (raw !== '' && !/^\d+$/.test(raw)) return
    const hf = raw === '' ? null : Number(raw)
    setForm(f => {
      const hi = f['Horómetro inicial']
      const isZeroHours = hi != null && hf != null && hf === hi
      const wasEstado = !!f['OD o FS']
      return {
        ...f,
        'Horómetro final': hf,
        'Cant. Hs.': calcHours(hi, hf),
        'OD o FS': isZeroHours ? (wasEstado ? f['OD o FS'] : '') : '',
        'Tarea 1': isZeroHours ? (wasEstado ? f['Tarea 1'] : '') : (wasEstado ? '' : f['Tarea 1']),
        'Observaciones 1': isZeroHours ? (wasEstado ? f['Observaciones 1'] : '') : (wasEstado ? '' : f['Observaciones 1']),
        'Tarea 2': isZeroHours || wasEstado ? '' : f['Tarea 2'],
        'Observaciones 2': isZeroHours || wasEstado ? '' : f['Observaciones 2']
      }
    })
  }

  const save = async () => {
    try {
      if (form['N° Parte'] == null || form['Horómetro inicial'] == null) {
        throw new Error('Este equipo no tiene una referencia previa de N° Parte u Horómetro inicial en la planilla. Debe cargarse una referencia antes de usar el formulario.')
      }
      const zeroHours = form['Horómetro final'] === form['Horómetro inicial']
      if (zeroHours && !form['OD o FS']) throw new Error('Como el horómetro inicial y final son iguales, seleccioná OD, FS o EM.')
      schema.parse(form)
      if ((form['Horómetro final'] ?? 0) < form['Horómetro inicial']) throw new Error('El horómetro final no puede ser menor al inicial.')
      if (!form['Supervisor Vial Cliente'].trim()) throw new Error('Supervisor Vial Cliente es obligatorio.')
      if (!form['Area de trabajo'].trim()) throw new Error('Área es obligatoria.')
      if (!form['Cambio de tareas planificadas'].trim()) throw new Error('Cambio de tareas es obligatorio.')
      if (!form['Información sobre Desgaste'].trim()) throw new Error('Desgaste es obligatorio.')
      if (!form.Combustible.trim()) throw new Error('Combustible es obligatorio.')
      if (!form.Aceite.trim()) throw new Error('Aceite es obligatorio.')
      if (!form['Tarea 1'].trim()) throw new Error('Tarea 1 es obligatoria.')
      if (!form['Observaciones 1'].trim()) throw new Error('Observaciones 1 es obligatoria.')
      if (!sig) throw new Error('La firma es obligatoria.')
      const item: PendingRecord = {
        id: form.ID, payload: form, signatureDataUrl: sig,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        syncStatus: 'pending', syncAttempts: 0
      }
      await db.syncQueue.put(item)
      setMsg('Registro guardado en el dispositivo. Hasta que se sincronice aparecerá en Pendientes.')
      setSig(undefined)
      setForm(blank(form.Proyecto || 'JOSE MARIA'))
      await reloadPending()
      if (navigator.onLine) await sync(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Revisá los campos obligatorios.')
    }
  }

  if (!data) return <main className="shell"><div className="card"><h1>DELTA MINING</h1><p>Preparando datos…</p><p>La primera apertura requiere internet.</p></div></main>
  const receiptsPromise = () => db.syncedRecords.orderBy('syncedAt').reverse().limit(100).toArray()

  return <main className="shell">
    <header>
      <div><strong>DELTA MINING</strong><span>Registro de Operaciones</span></div>
      <div className={online ? 'status ok' : 'status off'}>{online ? '● Conectado' : '● Sin conexión'} · {pending.length} pendientes</div>
    </header>
    <nav>
      <button onClick={() => setTab('form')} className={tab === 'form' ? 'active' : ''}>Nueva carga</button>
      <button onClick={() => setTab('pending')} className={tab === 'pending' ? 'active' : ''}>Pendientes ({pending.length})</button>
      <button onClick={() => setTab('receipts')} className={tab === 'receipts' ? 'active' : ''}>Comprobantes</button>
    </nav>

    {tab === 'form' && <>
      <div className="formToolbar">
        <button className="secondary" type="button" onClick={() => load(true)}>ACTUALIZAR LISTAS</button>
      </div>
      <section className="card formgrid">
        <p className="requiredNote wide">* Campos obligatorios</p>
        <h2 className="sectionTitle wide">DATOS</h2>
        <label>Fecha *<input required type="date" value={form.Fecha} onChange={e => set('Fecha', e.target.value)} /></label>
        <label>Operador *<select required value={form.Operador} onChange={e => set('Operador', e.target.value)}><option value="">Seleccionar…</option>{data.operadores.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label>Supervisor Delta *<select required value={form['Supervisor Delta']} onChange={e => set('Supervisor Delta', e.target.value)}><option value="">Seleccionar…</option>{data.supervisoresDelta.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label>Supervisor Vial Cliente *<select required value={form['Supervisor Vial Cliente']} onChange={e => set('Supervisor Vial Cliente', e.target.value)}><option value="">Seleccionar…</option>{data.supervisoresCliente.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label>Proyecto *<select required value={form.Proyecto} onChange={e => set('Proyecto', e.target.value)}><option value="JOSE MARIA">JOSÉ MARÍA</option><option value="FILO DEL SOL">FILO DEL SOL</option></select></label>
        <label>Área *<select required value={form['Area de trabajo']} onChange={e => set('Area de trabajo', e.target.value)}><option value="">Seleccionar…</option>{data.areas.map(x => <option key={x} value={x}>{x}</option>)}</select></label>

        <h2 className="sectionTitle wide">DATOS DEL EQUIPO</h2>
        <label>Interno *<select required value={form.Interno} onChange={e => chooseInterno(e.target.value)}><option value="">Seleccionar…</option>{data.equipos.map(e => <option key={e.id} value={e.id}>{e.id}</option>)}</select></label>
        <label>Equipo *<input readOnly value={equipment?.equipo || form.Equipo} /></label>
        <label>Turno *<select required value={form['Turno de trabajo']} onChange={e => set('Turno de trabajo', e.target.value)}><option>TURNO DIA</option><option>TURNO NOCHE</option></select></label>
        <label>N° Parte *<input className="locked" type="number" step="1" readOnly value={form['N° Parte'] ?? ''} placeholder="Sin referencia" /><small>Automático según la última carga del equipo.</small></label>
        <label>Horómetro inicial *<input className="locked" type="number" step="1" readOnly value={form['Horómetro inicial'] ?? ''} placeholder="Sin referencia" /><small>Automático: último horómetro final conocido.</small></label>
        <label>Horómetro final *<input required className={hfTooLow ? 'invalidField' : ''} type="text" inputMode="numeric" pattern="[0-9]*" value={form['Horómetro final'] ?? ''} onChange={e => changeHorometroFinal(e.target.value)} placeholder="Ingresar número entero" />{hfTooLow && <small className="fieldError">El horómetro final no puede ser menor que el inicial.</small>}</label>
        <label>Horas *<input className="locked" type="number" step="1" readOnly value={form['Cant. Hs.'] ?? ''} /></label>
        {form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro inicial'] === form['Horómetro final'] &&
          <label>OD / FS / EM *<select required value={form['OD o FS']} onChange={e => chooseEstado(e.target.value as EstadoEquipo)}><option value="">Seleccionar estado…</option><option>OD</option><option>FS</option><option>EM</option></select><small>Este campo solo aparece cuando HI = HF.</small></label>}
        <label className="wide">Cambio de tareas *<textarea required value={form['Cambio de tareas planificadas']} onChange={e => set('Cambio de tareas planificadas', e.target.value)} /></label>

        <h2 className="sectionTitle wide">CONSUMIBLES</h2>
        <label className="wide">Desgaste *<textarea required value={form['Información sobre Desgaste']} onChange={e => set('Información sobre Desgaste', e.target.value)} /></label>
        <label>Combustible *<input required value={form.Combustible} onChange={e => set('Combustible', e.target.value)} /></label>
        <label>Aceite *<input required value={form.Aceite} onChange={e => set('Aceite', e.target.value)} /></label>

        <h2 className="sectionTitle wide">TAREAS REALIZADAS</h2>
        <label className="wide">Tarea 1 *{form['OD o FS'] ? <input readOnly value={form['Tarea 1']} /> : <select required value={form['Tarea 1']} onChange={e => set('Tarea 1', e.target.value)} disabled={form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro inicial'] === form['Horómetro final']}><option value="">Seleccionar…</option>{tasks.map(t => <option key={t.id} value={t.tarea}>{t.tarea}</option>)}</select>}</label>
        <label className="wide">Observaciones 1 *<textarea required value={form['Observaciones 1']} onChange={e => set('Observaciones 1', e.target.value)} readOnly={!!form['OD o FS']} /></label>
        {!form['OD o FS'] && form['Horómetro inicial'] !== form['Horómetro final'] && form['Tarea 1'] && <>
          <label className="wide">Tarea 2<select value={form['Tarea 2']} onChange={e => set('Tarea 2', e.target.value)}><option value="">Sin segunda tarea</option>{tasks.map(t => <option key={t.id} value={t.tarea}>{t.tarea}</option>)}</select></label>
          {form['Tarea 2'] && <label className="wide">Observaciones 2<textarea value={form['Observaciones 2']} onChange={e => set('Observaciones 2', e.target.value)} /></label>}
        </>}
        <div className="wide"><label>Firma *</label><SignaturePad key={form.ID} onChange={setSig} /></div>
        {msg && <div className="notice wide">{msg}</div>}
        <button className="primary wide" disabled={hfTooLow} onClick={save}>GUARDAR REGISTRO</button>
      </section>
    </>}

    {tab === 'pending' && <section className="card">
      <div className="row"><h2>Pendientes</h2><button className="secondary" disabled={syncing} onClick={() => sync(true)}>{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</button></div>
      {msg && <div className="notice">{msg}</div>}
      {pending.length === 0 ? <p>No hay cargas pendientes.</p> : pending.map(p => <article className="item" key={p.id}><b>{p.payload.Interno}</b><span>{p.payload.Operador}</span><span>{p.payload.Fecha} · Parte {p.payload['N° Parte'] ?? 's/ref'}</span><small>{p.syncStatus}{p.lastSyncError ? ` · ${p.lastSyncError}` : ' · Guardado en este dispositivo'}</small></article>)}
    </section>}

    {tab === 'receipts' && <Receipts load={receiptsPromise} />}
  </main>
}

function Receipts({ load }: { load: () => Promise<any[]> }) {
  const [rows, setRows] = useState<any[]>([])

  useEffect(() => {
    load().then(setRows)
  }, [load])

  const copyReceipt = async (row: any) => {
    const p = row.payload as Rop02Record
    const code = receiptCode(row.id, p.Interno, p['N° Parte'])
    const text = [
      'DELTA MINING - COMPROBANTE ROP02',
      `Código: ${code}`,
      `Estado: SINCRONIZADO`,
      `Operador: ${p.Operador}`,
      `Fecha: ${p.Fecha}`,
      `Interno: ${p.Interno}`,
      `Equipo: ${p.Equipo}`,
      `Parte: ${p['N° Parte'] ?? ''}`,
      `HI: ${p['Horómetro inicial'] ?? ''}`,
      `HF: ${p['Horómetro final'] ?? ''}`,
      `Horas: ${p['Cant. Hs.'] ?? ''}`,
      `Sincronizado: ${formatDateTime(row.syncedAt)}`
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copiá el comprobante:', text)
    }
  }

  return <section className="card">
    <h2>Comprobantes de carga</h2>
    <p>Estas cargas fueron confirmadas por la planilla. El código sirve como constancia de la carga realizada.</p>
    {rows.length === 0 ? <p>Todavía no hay comprobantes en este dispositivo.</p> : rows.map(row => {
      const p = row.payload as Rop02Record
      const code = receiptCode(row.id, p.Interno, p['N° Parte'])
      return <article className="item" key={row.id}>
        <b>{p.Operador}</b>
        <span>{p.Interno} · {p.Equipo}</span>
        <span>{p.Fecha} · Parte {p['N° Parte'] ?? 's/ref'} · HI {p['Horómetro inicial'] ?? '-'} → HF {p['Horómetro final'] ?? '-'}</span>
        <small>✓ SINCRONIZADO · {formatDateTime(row.syncedAt)}</small>
        <small>Comprobante: {code}</small>
        <button className="secondary" type="button" onClick={() => copyReceipt(row)}>COPIAR COMPROBANTE</button>
      </article>
    })}
  </section>
}
