import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { checkRecord, createRecord, getBootstrap, getBootstrapLive, getReceipts, type ReceiptRecord } from './api'
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

const formatDate = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
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
  const [lastOperator, setLastOperator] = useState('')
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

          void definitive
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
      else if (ok) setMsg(`${ok} carga(s) sincronizada(s) correctamente. Ya puede consultarse el comprobante desde cualquier dispositivo.`)
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
    db.syncedRecords.clear().catch(() => undefined)
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
  const shiftRef = useMemo(() => form.Interno && data ? provisionalReference(form.Interno, data.equipmentState, pending) : null, [form.Interno, data, pending])
  const previousShift = shiftRef?.turnoAnterior || null
  const nightAllowed = previousShift === 'TURNO DIA'
  const hfTooLow = form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro final'] < form['Horómetro inicial']
  const set = (k: keyof Rop02Record, v: any) => setForm(f => ({ ...f, [k]: v }))

  const refreshReference = async (interno: string) => {
    if (!data || !interno) return null
    const localPending = pending
      .filter(p => p.payload.Interno === interno)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1)

    if (localPending || !navigator.onLine) {
      return provisionalReference(interno, data.equipmentState, pending)
    }

    const fresh = await getBootstrapLive()
    setData(fresh)
    await db.catalogs.put({ key: 'bootstrap', value: fresh })
    return provisionalReference(interno, fresh.equipmentState, pending)
  }

  const chooseInterno = async (v: string) => {
    if (!data) return
    const eq = data.equipos.find(e => e.id === v)
    const ref = provisionalReference(v, data.equipmentState, pending)
    setForm(f => ({
      ...f, Interno: v, Equipo: eq?.equipo || '', 'N° Parte': ref.parte,
      'Horómetro inicial': ref.hi, 'Horómetro final': null, 'Cant. Hs.': null,
      'Turno de trabajo': 'TURNO DIA',
      'Tarea 1': '', 'Tarea 2': '', 'Observaciones 1': '', 'Observaciones 2': '', 'OD o FS': ''
    }))
    setMsg('')

    if (!v) return
    try {
      const freshRef = await refreshReference(v)
      if (!freshRef) return
      setForm(f => f.Interno === v ? {
        ...f,
        'N° Parte': freshRef.parte,
        'Horómetro inicial': freshRef.hi,
        'Horómetro final': null,
        'Cant. Hs.': null,
        'Turno de trabajo': 'TURNO DIA'
      } : f)
      if (freshRef.turnoAnterior === 'TURNO NOCHE') {
        setMsg(`El último registro de ${v} es TURNO NOCHE. El próximo registro debe ser TURNO DIA; no se permitirá cargar otro TURNO NOCHE.`)
      }
    } catch {
      if (navigator.onLine) setMsg('No se pudo verificar en este momento el último turno del equipo. Se volverá a controlar antes de aceptar un TURNO NOCHE.')
    }
  }

  const chooseTurno = async (v: string) => {
    if (v !== 'TURNO NOCHE') {
      setMsg('')
      set('Turno de trabajo', v)
      return
    }

    if (!form.Interno) {
      const message = 'Primero seleccioná un equipo antes de elegir TURNO NOCHE.'
      setMsg(message)
      window.alert(message)
      set('Turno de trabajo', 'TURNO DIA')
      return
    }

    let ref = shiftRef
    try {
      ref = await refreshReference(form.Interno)
    } catch {
      const message = `No se pudo verificar el último turno de ${form.Interno} en la planilla. Por seguridad, TURNO NOCHE no fue habilitado.`
      setMsg(message)
      window.alert(message)
      set('Turno de trabajo', 'TURNO DIA')
      return
    }

    if (ref?.turnoAnterior !== 'TURNO DIA') {
      const anterior = ref?.turnoAnterior || 'sin turno previo informado'
      const message = `No se puede cargar TURNO NOCHE para ${form.Interno}. El registro anterior debe ser TURNO DIA y actualmente figura como ${anterior}.`
      setMsg(message)
      window.alert(message)
      set('Turno de trabajo', 'TURNO DIA')
      return
    }

    setMsg('')
    set('Turno de trabajo', 'TURNO NOCHE')
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
      const missing: string[] = []
      const requireField = (label: string, value: unknown) => {
        if (value == null || (typeof value === 'string' && !value.trim())) missing.push(label)
      }

      requireField('Fecha', form.Fecha)
      requireField('Operador', form.Operador)
      requireField('Supervisor Delta', form['Supervisor Delta'])
      requireField('Supervisor Vial Cliente', form['Supervisor Vial Cliente'])
      requireField('Proyecto', form.Proyecto)
      requireField('Área', form['Area de trabajo'])
      requireField('Interno', form.Interno)
      requireField('Turno', form['Turno de trabajo'])
      requireField('Horómetro final', form['Horómetro final'])
      requireField('Cambio de tareas', form['Cambio de tareas planificadas'])
      requireField('Desgaste', form['Información sobre Desgaste'])
      requireField('Combustible', form.Combustible)
      requireField('Aceite', form.Aceite)

      if (zeroHours) {
        requireField('OD / FS / EM', form['OD o FS'])
      } else {
        requireField('Tarea 1', form['Tarea 1'])
        requireField('Observaciones 1', form['Observaciones 1'])
      }

      if (!sig) missing.push('Firma')

      if (missing.length) {
        throw new Error(`Faltan completar los siguientes campos obligatorios: ${missing.join(', ')}.`)
      }

      if (form['Turno de trabajo'] === 'TURNO NOCHE') {
        let latestRef = shiftRef
        try {
          latestRef = await refreshReference(form.Interno)
        } catch {
          throw new Error(`No se pudo verificar el último turno de ${form.Interno} en la planilla. TURNO NOCHE no puede guardarse hasta poder verificarlo.`)
        }
        if (latestRef?.turnoAnterior !== 'TURNO DIA') {
          const anterior = latestRef?.turnoAnterior || 'sin turno previo informado'
          throw new Error(`No se puede cargar TURNO NOCHE para ${form.Interno}. El registro anterior debe ser TURNO DIA y actualmente figura como ${anterior}.`)
        }
      }

      schema.parse(form)
      if ((form['Horómetro final'] ?? 0) < form['Horómetro inicial']) throw new Error('El horómetro final no puede ser menor al inicial.')

      const item: PendingRecord = {
        id: form.ID, payload: form, signatureDataUrl: sig,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        syncStatus: 'pending', syncAttempts: 0
      }
      await db.syncQueue.put(item)
      setLastOperator(form.Operador)
      setMsg('Registro guardado en el dispositivo. Hasta que se sincronice aparecerá en Pendientes.')
      setSig(undefined)
      setForm(blank(form.Proyecto || 'JOSE MARIA'))
      await reloadPending()
      if (navigator.onLine) await sync(false)
    } catch (e) {
      if (e instanceof z.ZodError) {
        const labels: Record<string, string> = {
          Fecha: 'Fecha',
          Interno: 'Interno',
          Equipo: 'Equipo',
          Operador: 'Operador',
          'Supervisor Delta': 'Supervisor Delta',
          'Supervisor Vial Cliente': 'Supervisor Vial Cliente',
          'Turno de trabajo': 'Turno',
          'N° Parte': 'N° Parte',
          Proyecto: 'Proyecto',
          'Area de trabajo': 'Área',
          'Horómetro inicial': 'Horómetro inicial',
          'Horómetro final': 'Horómetro final',
          'Cambio de tareas planificadas': 'Cambio de tareas',
          'Información sobre Desgaste': 'Desgaste',
          Combustible: 'Combustible',
          Aceite: 'Aceite',
          'Tarea 1': 'Tarea 1',
          'Observaciones 1': 'Observaciones 1'
        }
        const fields = [...new Set(e.issues.map(issue => labels[String(issue.path[0])] || String(issue.path[0])).filter(Boolean))]
        setMsg(`Revisá los siguientes campos obligatorios: ${fields.join(', ')}.`)
      } else {
        setMsg(e instanceof Error ? e.message : 'Revisá los campos obligatorios.')
      }
    }
  }

  if (!data) return <main className="shell"><div className="card"><h1>DELTA MINING</h1><p>Preparando datos…</p><p>La primera apertura requiere internet.</p></div></main>

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
        <label>Operador *<select required value={form.Operador} onChange={e => { set('Operador', e.target.value); setLastOperator(e.target.value) }}><option value="">Seleccionar…</option>{data.operadores.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label>Supervisor Delta *<select required value={form['Supervisor Delta']} onChange={e => set('Supervisor Delta', e.target.value)}><option value="">Seleccionar…</option>{data.supervisoresDelta.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label>Supervisor Vial Cliente *<select required value={form['Supervisor Vial Cliente']} onChange={e => set('Supervisor Vial Cliente', e.target.value)}><option value="">Seleccionar…</option>{data.supervisoresCliente.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label>Proyecto *<select required value={form.Proyecto} onChange={e => set('Proyecto', e.target.value)}><option value="JOSE MARIA">JOSÉ MARÍA</option><option value="FILO DEL SOL">FILO DEL SOL</option></select></label>
        <label>Área *<select required value={form['Area de trabajo']} onChange={e => set('Area de trabajo', e.target.value)}><option value="">Seleccionar…</option>{data.areas.map(x => <option key={x} value={x}>{x}</option>)}</select></label>

        <h2 className="sectionTitle wide">DATOS DEL EQUIPO</h2>
        <label>Interno *<select required value={form.Interno} onChange={e => chooseInterno(e.target.value)}><option value="">Seleccionar…</option>{data.equipos.map(e => <option key={e.id} value={e.id}>{e.id}</option>)}</select></label>
        <label>Equipo *<input readOnly value={equipment?.equipo || form.Equipo} /></label>
        <label>Turno *<select required value={form['Turno de trabajo']} onChange={e => chooseTurno(e.target.value)}><option>TURNO DIA</option><option>TURNO NOCHE</option></select>{form.Interno && <small>{previousShift ? `Último turno registrado: ${previousShift}.` : 'No hay turno anterior disponible.'} {!nightAllowed && ' El turno noche requiere un turno día inmediatamente anterior.'}</small>}</label>
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

    {tab === 'receipts' && <Receipts operators={data.operadores} defaultOperator={lastOperator} />}
  </main>
}

function Receipts({ operators, defaultOperator }: { operators: string[], defaultOperator: string }) {
  const [operator, setOperator] = useState(defaultOperator)
  const [rows, setRows] = useState<ReceiptRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!operator) {
      setRows([])
      setError('')
      return
    }
    if (!navigator.onLine) {
      setRows([])
      setError('Necesitás conexión para consultar comprobantes confirmados en la planilla.')
      return
    }

    setLoading(true)
    setError('')
    try {
      setRows(await getReceipts(operator))
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : 'No se pudieron consultar los comprobantes.')
    } finally {
      setLoading(false)
    }
  }, [operator])

  useEffect(() => {
    if (operator) load()
  }, [operator, load])

  const copyReceipt = async (row: ReceiptRecord) => {
    const text = [
      'DELTA MINING - COMPROBANTE ROP02',
      `Código: ${row.codigo}`,
      'Estado: CONFIRMADO EN PLANILLA',
      `Operador: ${row.operador}`,
      `Fecha: ${formatDate(row.fecha)}`,
      `Interno: ${row.interno}`,
      `Equipo: ${row.equipo}`,
      `Turno: ${row.turno}`,
      `Proyecto: ${row.proyecto}`,
      `Área: ${row.area}`,
      `Parte: ${row.parte ?? ''}`,
      `HI: ${row.hi ?? ''}`,
      `HF: ${row.hf ?? ''}`,
      `Horas: ${row.horas ?? ''}`,
      row.estado ? `Estado equipo: ${row.estado}` : '',
      'Fuente: Google Sheets - Registro para operarios'
    ].filter(Boolean).join('\n')

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copiá el comprobante:', text)
    }
  }

  const sortedOperators = useMemo(() => [...operators].sort((a, b) => a.localeCompare(b, 'es')), [operators])

  return <section className="card">
    <h2>Comprobantes de carga</h2>
    <p>Seleccioná un operador. Los comprobantes se consultan directamente desde la planilla y pueden verse desde cualquier dispositivo.</p>

    <label>Operador
      <select value={operator} onChange={e => setOperator(e.target.value)}>
        <option value="">Seleccionar operador…</option>
        {sortedOperators.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
    </label>

    <div className="formToolbar">
      <button className="secondary" type="button" disabled={!operator || loading} onClick={load}>{loading ? 'CONSULTANDO…' : 'ACTUALIZAR COMPROBANTES'}</button>
    </div>

    {error && <div className="notice">{error}</div>}
    {!operator ? <p>Elegí un operador para ver sus cargas confirmadas.</p> : loading ? <p>Consultando la planilla…</p> : rows.length === 0 && !error ? <p>No hay cargas confirmadas para este operador.</p> : rows.map(row => <article className="item" key={`${row.id}-${row.codigo}`}>
      <b>{row.operador}</b>
      <span>{row.interno} · {row.equipo}</span>
      <span>{formatDate(row.fecha)} · Parte {row.parte ?? 's/ref'} · HI {row.hi ?? '-'} → HF {row.hf ?? '-'}</span>
      <small>✓ CONFIRMADO EN PLANILLA</small>
      <small>Comprobante: {row.codigo}</small>
      <button className="secondary" type="button" onClick={() => copyReceipt(row)}>COPIAR COMPROBANTE</button>
    </article>)}
  </section>
}
