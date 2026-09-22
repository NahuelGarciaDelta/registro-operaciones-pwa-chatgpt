import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { checkRecord, createRecord, getBootstrap, getBootstrapLive, getReceipts, type ReceiptRecord } from './api'
import { db } from './db'
import { calcHours, estadoTexto, provisionalReference, tasksForEquipment } from './lib/business'
import SearchableSelect from './components/SearchableSelect'
import SignaturePad from './components/SignaturePad'
import type { BootstrapData, EstadoEquipo, PendingRecord, ProjectCatalog, Proyecto, Rop02Record } from './types'

const PROJECTS: Proyecto[] = ['JOSE MARIA', 'FILO DEL SOL']
const EMPTY_CATALOG: ProjectCatalog = { equipos: [], supervisoresDelta: [], supervisoresCliente: [], equipmentState: [] }

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

const blank = (project: Proyecto | '' = ''): Rop02Record => ({
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

const normalizeProject = (value: string): Proyecto | null =>
  value === 'JOSE MARIA' || value === 'FILO DEL SOL' ? value : null

const canonicalInterno = (value: string) => value.trim().toUpperCase().replace(/-(JM|FS)$/i, '')
const normalizeEquipmentType = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('es')
const isPickupEquipment = (value: string) => normalizeEquipmentType(value).includes('camioneta')
const isTruckOrPickupEquipment = (value: string) => normalizeEquipmentType(value).includes('camion')

const projectCatalog = (data: BootstrapData | null, project: Proyecto | null): ProjectCatalog => {
  if (!data || !project) return EMPTY_CATALOG
  const scoped = data.projectCatalogs?.[project]
  if (scoped) return scoped
  if (project === 'JOSE MARIA') {
    return {
      equipos: data.equipos || [],
      supervisoresDelta: data.supervisoresDelta || [],
      supervisoresCliente: data.supervisoresCliente || [],
      equipmentState: data.equipmentState || []
    }
  }
  return EMPTY_CATALOG
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
  const [turnoBlocked, setTurnoBlocked] = useState(false)
  const [qrLock, setQrLock] = useState<{ interno: string; proyecto: Proyecto } | null>(null)
  const syncInFlight = useRef(false)
  const qrHandled = useRef(false)

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

  const currentProject = normalizeProject(form.Proyecto)
  const catalog = useMemo(() => projectCatalog(data, currentProject), [data, currentProject])
  const equipment = useMemo(() => catalog.equipos.find(e => e.id === form.Interno), [catalog.equipos, form.Interno])
  const equipmentType = equipment?.equipo || form.Equipo
  const pickupEquipment = isPickupEquipment(equipmentType)
  const freeTaskEquipment = isTruckOrPickupEquipment(equipmentType)
  const initialMeterLabel = pickupEquipment ? 'Kilometraje inicial' : 'Horómetro inicial'
  const finalMeterLabel = pickupEquipment ? 'Kilometraje final' : 'Horómetro final'
  const totalMeterLabel = pickupEquipment ? 'Kilómetros recorridos' : 'Horas'
  const meterNoun = pickupEquipment ? 'kilometraje' : 'horómetro'
  const tasks = useMemo(() => tasksForEquipment(data?.tareas || [], form.Equipo), [data, form.Equipo])
  const shiftRef = useMemo(
    () => form.Interno && data && currentProject
      ? provisionalReference(form.Interno, catalog.equipmentState, pending, currentProject)
      : null,
    [form.Interno, data, catalog.equipmentState, pending, currentProject]
  )
  const previousShift = shiftRef?.turnoAnterior || null
  const nightAllowed = previousShift === 'TURNO DIA'
  const turnoSaveBlocked = form['Turno de trabajo'] === 'TURNO NOCHE' && (turnoBlocked || !nightAllowed)
  const hfTooLow = form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro final'] < form['Horómetro inicial']
  const successNotice = msg.startsWith('Registro guardado en el dispositivo.')
    || msg.includes('sincronizada(s) correctamente')
    || msg === 'Listas actualizadas desde la fuente de datos.'
    || msg === 'No hay cargas pendientes de sincronización.'
  const set = (k: keyof Rop02Record, v: any) => setForm(f => ({ ...f, [k]: v }))

  const chooseProject = (project: Proyecto) => {
    if (qrLock) return
    setTurnoBlocked(false)
    setSig(undefined)
    setMsg('')
    setForm(f => ({
      ...f,
      Proyecto: project,
      Interno: '', Equipo: '', 'Supervisor Delta': '', 'Supervisor Vial Cliente': '',
      'Turno de trabajo': 'TURNO DIA', 'N° Parte': null,
      'Horómetro inicial': null, 'Horómetro final': null, 'Cant. Hs.': null,
      'Tarea 1': '', 'Tarea 2': '', 'Observaciones 1': '', 'Observaciones 2': '', 'OD o FS': ''
    }))
  }

  const refreshReference = async (interno: string, project: Proyecto) => {
    if (!data || !interno) return null
    const scopedCatalog = projectCatalog(data, project)
    const localPending = pending
      .filter(p => p.payload.Interno === interno && p.payload.Proyecto === project)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1)

    if (localPending || !navigator.onLine) {
      return provisionalReference(interno, scopedCatalog.equipmentState, pending, project)
    }

    const fresh = await getBootstrapLive()
    setData(fresh)
    await db.catalogs.put({ key: 'bootstrap', value: fresh })
    const freshCatalog = projectCatalog(fresh, project)
    return provisionalReference(interno, freshCatalog.equipmentState, pending, project)
  }

  const chooseInterno = async (v: string, project: Proyecto) => {
    if (!data) return
    if (qrLock && (v !== qrLock.interno || project !== qrLock.proyecto)) return
    setTurnoBlocked(false)
    const scopedCatalog = projectCatalog(data, project)
    const eq = scopedCatalog.equipos.find(e => e.id === v)
    const ref = provisionalReference(v, scopedCatalog.equipmentState, pending, project)
    setForm(f => ({
      ...f, Proyecto: project, Interno: v, Equipo: eq?.equipo || '', 'N° Parte': ref.parte,
      'Horómetro inicial': ref.hi, 'Horómetro final': null, 'Cant. Hs.': null,
      'Turno de trabajo': 'TURNO DIA',
      'Tarea 1': '', 'Tarea 2': '', 'Observaciones 1': '', 'Observaciones 2': '', 'OD o FS': ''
    }))
    setMsg('')

    if (!v) return
    try {
      const freshRef = await refreshReference(v, project)
      if (!freshRef) return
      setForm(f => f.Interno === v && f.Proyecto === project ? {
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

  useEffect(() => {
    if (!data || qrHandled.current) return
    const params = new URLSearchParams(window.location.search)
    const rawInterno = params.get('interno')?.trim().toUpperCase()
    if (!rawInterno) {
      qrHandled.current = true
      return
    }

    const key = canonicalInterno(rawInterno)
    const requestedProjectRaw = params.get('proyecto')?.trim().toUpperCase()
    const requestedProject = PROJECTS.find(p => p === requestedProjectRaw)
    const availableProjects = (data.projects?.length ? data.projects : PROJECTS) as Proyecto[]

    const exactMatches = availableProjects.flatMap(project =>
      projectCatalog(data, project).equipos
        .filter(e => e.id.trim().toUpperCase() === rawInterno)
        .map(e => ({ project, equipment: e }))
    )

    const canonicalMatches = availableProjects.flatMap(project =>
      projectCatalog(data, project).equipos
        .filter(e => canonicalInterno(e.id) === key)
        .map(e => ({ project, equipment: e }))
    )

    let target: { project: Proyecto; equipment: { id: string; equipo: string } } | undefined

    if (requestedProject) {
      target = exactMatches.find(x => x.project === requestedProject)
        || canonicalMatches.find(x => x.project === requestedProject)
    }

    if (!target) {
      if (exactMatches.length === 1) target = exactMatches[0]
      else if (exactMatches.length > 1) {
        qrHandled.current = true
        setMsg(`El equipo ${key} figura simultáneamente en EQUIPOS JM y EQUIPOS FS. Dejá el equipo solamente en el proyecto donde está operando antes de cargar.`)
        return
      } else if (canonicalMatches.length === 1) target = canonicalMatches[0]
      else if (canonicalMatches.length > 1) {
        qrHandled.current = true
        setMsg(`El equipo ${key} figura simultáneamente en EQUIPOS JM y EQUIPOS FS. Dejá el equipo solamente en el proyecto donde está operando antes de cargar.`)
        return
      }
    }

    qrHandled.current = true
    if (!target) {
      setMsg(`El equipo indicado por el QR (${key}) no está cargado en EQUIPOS JM ni EQUIPOS FS.`)
      return
    }

    setQrLock({ interno: target.equipment.id, proyecto: target.project })
    setTab('form')
    void chooseInterno(target.equipment.id, target.project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const chooseTurno = async (v: string) => {
    if (v !== 'TURNO NOCHE') {
      setTurnoBlocked(false)
      setMsg('')
      set('Turno de trabajo', v)
      return
    }

    set('Turno de trabajo', 'TURNO NOCHE')

    if (!form.Interno) {
      setTurnoBlocked(true)
      setMsg('Primero seleccioná un equipo antes de elegir TURNO NOCHE.')
      return
    }

    if (!currentProject) {
      setTurnoBlocked(true)
      setMsg('Primero seleccioná un proyecto antes de elegir TURNO NOCHE.')
      return
    }

    let ref = shiftRef
    try {
      ref = await refreshReference(form.Interno, currentProject)
    } catch {
      setTurnoBlocked(true)
      setMsg(`No se pudo verificar el último turno de ${form.Interno} en la planilla. Por seguridad, TURNO NOCHE no fue habilitado.`)
      return
    }

    if (ref?.turnoAnterior !== 'TURNO DIA') {
      const anterior = ref?.turnoAnterior || 'sin turno previo informado'
      setTurnoBlocked(true)
      setMsg(`No se puede cargar TURNO NOCHE para ${form.Interno}. El registro anterior debe ser TURNO DIA y actualmente figura como ${anterior}.`)
      return
    }

    setTurnoBlocked(false)
    setMsg('')
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
      if (!currentProject) {
        throw new Error('Seleccioná un proyecto antes de guardar el registro.')
      }

      if (qrLock && (currentProject !== qrLock.proyecto || form.Interno !== qrLock.interno)) {
        throw new Error('El proyecto y el equipo de una carga iniciada por QR no pueden modificarse.')
      }

      if (turnoSaveBlocked) {
        throw new Error('No se puede guardar este registro mientras el turno sea TURNO NOCHE. Cambiá el turno a TURNO DIA para continuar.')
      }

      if (form['N° Parte'] == null || form['Horómetro inicial'] == null) {
        throw new Error(`Este equipo no tiene una referencia previa de N° Parte o ${pickupEquipment ? 'kilometraje inicial' : 'horómetro inicial'} en ${currentProject}. Debe cargarse una referencia antes de usar el formulario.`)
      }

      const zeroHours = form['Horómetro final'] === form['Horómetro inicial']
      const missing: string[] = []
      const requireField = (label: string, value: unknown) => {
        if (value == null || (typeof value === 'string' && !value.trim())) missing.push(label)
      }

      requireField('Proyecto', form.Proyecto)
      requireField('Fecha', form.Fecha)
      requireField('Operador', form.Operador)
      requireField('Supervisor Delta', form['Supervisor Delta'])
      requireField('Supervisor Vial Cliente', form['Supervisor Vial Cliente'])
      requireField('Área', form['Area de trabajo'])
      requireField('Interno', form.Interno)
      requireField('Turno', form['Turno de trabajo'])
      requireField(finalMeterLabel, form['Horómetro final'])
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
          latestRef = await refreshReference(form.Interno, currentProject)
        } catch {
          setTurnoBlocked(true)
          throw new Error(`No se pudo verificar el último turno de ${form.Interno} en la planilla. TURNO NOCHE no puede guardarse hasta poder verificarlo.`)
        }
        if (latestRef?.turnoAnterior !== 'TURNO DIA') {
          const anterior = latestRef?.turnoAnterior || 'sin turno previo informado'
          setTurnoBlocked(true)
          throw new Error(`No se puede cargar TURNO NOCHE para ${form.Interno}. El registro anterior debe ser TURNO DIA y actualmente figura como ${anterior}. Cambiá el turno para continuar.`)
        }
        setTurnoBlocked(false)
      }

      schema.parse(form)
      if ((form['Horómetro final'] ?? 0) < form['Horómetro inicial']) throw new Error(`El ${meterNoun} final no puede ser menor al inicial.`)

      const item: PendingRecord = {
        id: form.ID, payload: form, signatureDataUrl: sig,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        syncStatus: 'pending', syncAttempts: 0
      }
      await db.syncQueue.put(item)
      setLastOperator(form.Operador)
      setMsg('Registro guardado en el dispositivo. Hasta que se sincronice aparecerá en Pendientes.')
      setSig(undefined)
      setTurnoBlocked(false)

      if (qrLock && data) {
        const next = blank(qrLock.proyecto)
        const lockedCatalog = projectCatalog(data, qrLock.proyecto)
        const eq = lockedCatalog.equipos.find(e => e.id === qrLock.interno)
        const ref = provisionalReference(qrLock.interno, lockedCatalog.equipmentState, [...pending, item], qrLock.proyecto)
        next.Interno = qrLock.interno
        next.Equipo = eq?.equipo || form.Equipo
        next['N° Parte'] = ref.parte
        next['Horómetro inicial'] = ref.hi
        setForm(next)
      } else {
        setForm(blank())
      }

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
          'Horómetro inicial': initialMeterLabel,
          'Horómetro final': finalMeterLabel,
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

  const projectOptions = (data.projects?.length ? data.projects : PROJECTS) as Proyecto[]

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
        <label className="wide">Proyecto *{qrLock
          ? <><input className="locked" readOnly value={qrLock.proyecto === 'JOSE MARIA' ? 'JOSÉ MARÍA' : 'FILO DEL SOL'} /><small>Asignado automáticamente por el QR del equipo.</small></>
          : <SearchableSelect
              required
              value={form.Proyecto}
              options={projectOptions.map(project => ({ value: project, label: project === 'JOSE MARIA' ? 'JOSÉ MARÍA' : 'FILO DEL SOL' }))}
              onChange={value => value && chooseProject(value as Proyecto)}
              displayPlaceholder="Seleccionar proyecto…"
              placeholder="Buscar proyecto…"
            />}
        </label>
        <label>Fecha *<input required type="date" value={form.Fecha} onChange={e => set('Fecha', e.target.value)} /></label>
        <label>Operador *<SearchableSelect required value={form.Operador} options={data.operadores} onChange={value => { set('Operador', value); if (value) setLastOperator(value) }} placeholder="Buscar nombre o apellido…" /></label>
        <label>Supervisor Delta *<SearchableSelect required disabled={!currentProject} value={form['Supervisor Delta']} options={catalog.supervisoresDelta} onChange={value => set('Supervisor Delta', value)} placeholder="Buscar supervisor…" /></label>
        <label>Supervisor Vial Cliente *<SearchableSelect required disabled={!currentProject} value={form['Supervisor Vial Cliente']} options={catalog.supervisoresCliente} onChange={value => set('Supervisor Vial Cliente', value)} placeholder="Buscar supervisor…" /></label>
        <label>Área *<SearchableSelect required value={form['Area de trabajo']} options={data.areas} onChange={value => set('Area de trabajo', value)} placeholder="Buscar área…" /></label>

        <h2 className="sectionTitle wide">DATOS DEL EQUIPO</h2>
        <label>Interno *{qrLock
          ? <><input className="locked" readOnly value={qrLock.interno} /><small>Equipo fijado por el QR escaneado.</small></>
          : <SearchableSelect required disabled={!currentProject} value={form.Interno} options={catalog.equipos.map(e => e.id)} onChange={value => currentProject && void chooseInterno(value, currentProject)} placeholder="Buscar interno…" />}
        </label>
        <label>Equipo *<input readOnly value={equipment?.equipo || form.Equipo} /></label>
        <label>Turno *<SearchableSelect required value={form['Turno de trabajo']} options={['TURNO DIA', 'TURNO NOCHE']} onChange={value => value && void chooseTurno(value)} placeholder="Buscar turno…" />{form.Interno && <small>{previousShift ? `Último turno registrado: ${previousShift}.` : 'No hay turno anterior disponible.'} {!nightAllowed && ' El turno noche requiere un turno día inmediatamente anterior.'}{turnoSaveBlocked && ' Debés cambiar el turno antes de guardar.'}</small>}</label>
        <label>N° Parte *<input className="locked" type="number" step="1" readOnly value={form['N° Parte'] ?? ''} placeholder="Sin referencia" /><small>{currentProject ? `Automático según la última carga del equipo en ${currentProject}.` : 'Automático según la última carga del equipo en el proyecto seleccionado.'}</small></label>
        <label>{initialMeterLabel} *<input className="locked" type="number" step="1" readOnly value={form['Horómetro inicial'] ?? ''} placeholder="Sin referencia" /><small>Automático: último {pickupEquipment ? 'kilometraje' : 'horómetro'} final conocido.</small></label>
        <label>{finalMeterLabel} *<input required className={hfTooLow ? 'invalidField' : ''} type="text" inputMode="numeric" pattern="[0-9]*" value={form['Horómetro final'] ?? ''} onChange={e => changeHorometroFinal(e.target.value)} placeholder="Ingresar número entero" />{hfTooLow && <small className="fieldError">El {meterNoun} final no puede ser menor que el inicial.</small>}</label>
        <label>{totalMeterLabel} *<input className="locked" type="number" step="1" readOnly value={form['Cant. Hs.'] ?? ''} /></label>
        {form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro inicial'] === form['Horómetro final'] &&
          <label>OD / FS / EM *<SearchableSelect required value={form['OD o FS']} options={['OD', 'FS', 'EM']} onChange={value => chooseEstado(value as EstadoEquipo)} placeholder="Buscar estado…" /><small>Este campo solo aparece cuando {pickupEquipment ? 'el kilometraje inicial es igual al final' : 'HI = HF'}.</small></label>}
        <label className="wide">Cambio de tareas *<textarea className="compactTextarea" required value={form['Cambio de tareas planificadas']} onChange={e => set('Cambio de tareas planificadas', e.target.value)} /></label>

        <h2 className="sectionTitle wide">CONSUMIBLES</h2>
        <label className="wide">Desgaste *<textarea className="compactTextarea" required value={form['Información sobre Desgaste']} onChange={e => set('Información sobre Desgaste', e.target.value)} /></label>
        <label>Combustible *<input required value={form.Combustible} onChange={e => set('Combustible', e.target.value)} /></label>
        <label>Aceite *<input required value={form.Aceite} onChange={e => set('Aceite', e.target.value)} /></label>

        <h2 className="sectionTitle wide">TAREAS REALIZADAS</h2>
        <label className="wide">Tarea 1 *{form['OD o FS']
          ? <input readOnly value={form['Tarea 1']} />
          : freeTaskEquipment
            ? <input required value={form['Tarea 1']} onChange={e => set('Tarea 1', e.target.value)} placeholder="Escribir tarea realizada…" />
            : <SearchableSelect required disabled={form['Horómetro inicial'] != null && form['Horómetro final'] != null && form['Horómetro inicial'] === form['Horómetro final']} value={form['Tarea 1']} options={tasks.map(t => t.tarea)} onChange={value => set('Tarea 1', value)} placeholder="Buscar tarea…" />}
        </label>
        <label className="wide">Observaciones 1 *<textarea required value={form['Observaciones 1']} onChange={e => set('Observaciones 1', e.target.value)} readOnly={!!form['OD o FS']} /></label>
        {!form['OD o FS'] && form['Horómetro inicial'] !== form['Horómetro final'] && form['Tarea 1'] && <>
          <label className="wide">Tarea 2{freeTaskEquipment
            ? <input value={form['Tarea 2']} onChange={e => set('Tarea 2', e.target.value)} placeholder="Escribir segunda tarea…" />
            : <SearchableSelect value={form['Tarea 2']} options={tasks.map(t => t.tarea)} onChange={value => set('Tarea 2', value)} placeholder="Buscar tarea…" />}
          </label>
          {form['Tarea 2'] && <label className="wide">Observaciones 2<textarea value={form['Observaciones 2']} onChange={e => set('Observaciones 2', e.target.value)} /></label>}
        </>}
        <div className="wide"><label>Firma *</label><SignaturePad key={form.ID} onChange={setSig} /></div>
        {msg && <div className={`notice wide${successNotice ? ' success' : ''}`}>{msg}</div>}
        <button className="primary wide" disabled={hfTooLow || turnoSaveBlocked} onClick={save}>GUARDAR REGISTRO</button>
      </section>
    </>}

    {tab === 'pending' && <section className="card">
      <div className="row"><h2>Pendientes</h2><button className="secondary" disabled={syncing} onClick={() => sync(true)}>{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</button></div>
      {msg && <div className={`notice${successNotice ? ' success' : ''}`}>{msg}</div>}
      {pending.length === 0 ? <p>No hay cargas pendientes.</p> : pending.map(p => <article className="item" key={p.id}><b>{p.payload.Interno}</b><span>{p.payload.Operador}</span><span>{p.payload.Proyecto} · {p.payload.Fecha} · Parte {p.payload['N° Parte'] ?? 's/ref'}</span><small>{p.syncStatus}{p.lastSyncError ? ` · ${p.lastSyncError}` : ' · Guardado en este dispositivo'}</small></article>)}
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
    <p>Seleccioná un operador. Los comprobantes se consultan directamente desde las planillas R_OP02_JM y R_OP02_FS.</p>

    <label>Operador
      <SearchableSelect value={operator} options={sortedOperators} onChange={setOperator} placeholder="Buscar nombre o apellido…" />
    </label>

    <div className="formToolbar">
      <button className="secondary" type="button" disabled={!operator || loading} onClick={load}>{loading ? 'CONSULTANDO…' : 'ACTUALIZAR COMPROBANTES'}</button>
    </div>

    {error && <div className="notice">{error}</div>}
    {!operator ? <p>Elegí un operador para ver sus cargas confirmadas.</p> : loading ? <p>Consultando la planilla…</p> : rows.length === 0 && !error ? <p>No hay cargas confirmadas para este operador.</p> : rows.map(row => <article className="item" key={`${row.id}-${row.codigo}`}>
      <b>{row.operador}</b>
      <span>{row.interno} · {row.equipo}</span>
      <span>{formatDate(row.fecha)} · {row.proyecto} · Parte {row.parte ?? 's/ref'} · HI {row.hi ?? '-'} → HF {row.hf ?? '-'}</span>
      <small>✓ CONFIRMADO EN PLANILLA</small>
      <small>Comprobante: {row.codigo}</small>
      <button className="secondary" type="button" onClick={() => copyReceipt(row)}>COPIAR COMPROBANTE</button>
    </article>)}
  </section>
}
