import type { Plugin } from 'vite'

export default function instantSaveFeedbackPlugin(): Plugin {
  return {
    name: 'delta-instant-save-feedback',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]src[\\/]App\.tsx$/.test(id)) return null

      const before = `      await db.syncQueue.delete(item.id).catch(() => undefined)
      await reloadPending()

      const operator = form.Operador
      setLastOperator(operator)
      setTurnoBlocked(false)

      let refreshedData = data
      try {
        const fresh = await getBootstrapLive()
        refreshedData = fresh
        setData(fresh)
        await db.catalogs.put({ key: 'bootstrap', value: fresh })
      } catch { /* el registro ya está confirmado; no invalidar el éxito */ }

      setSig(undefined)

      if (qrLock && refreshedData) {
        const next = blank(qrLock.proyecto)
        const lockedCatalog = projectCatalog(refreshedData, qrLock.proyecto)
        const eq = lockedCatalog.equipos.find(e => e.id === qrLock.interno)
        const confirmedPart = definitive['N° Parte']
        const confirmedHf = definitive['Horómetro final']

        next.Interno = qrLock.interno
        next.Equipo = eq?.equipo || definitive.Equipo || form.Equipo
        next['N° Parte'] = typeof confirmedPart === 'number' ? confirmedPart + 1 : null
        next['Horómetro inicial'] = typeof confirmedHf === 'number' ? confirmedHf : null
        setForm(next)
      } else {
        setForm(blank())
      }

      setMsg('REGISTRO GUARDADO CORRECTAMENTE. El registro ya está confirmado en la planilla y disponible para otros dispositivos. El comprobante queda disponible en Comprobantes.')`

      const after = `      // createRecord/checkRecord ya confirmó el registro en el servidor.
      // Desde este punto no bloqueamos más al operador con tareas secundarias.
      const operator = form.Operador
      setLastOperator(operator)
      setTurnoBlocked(false)
      setSig(undefined)

      // Preparar el próximo parte inmediatamente con la respuesta definitiva del servidor,
      // sin esperar a descargar nuevamente todos los catálogos y estados.
      if (qrLock && data) {
        const next = blank(qrLock.proyecto)
        const lockedCatalog = projectCatalog(data, qrLock.proyecto)
        const eq = lockedCatalog.equipos.find(e => e.id === qrLock.interno)
        const confirmedPart = definitive['N° Parte']
        const confirmedHf = definitive['Horómetro final']

        next.Interno = qrLock.interno
        next.Equipo = eq?.equipo || definitive.Equipo || form.Equipo
        next['N° Parte'] = typeof confirmedPart === 'number' ? confirmedPart + 1 : null
        next['Horómetro inicial'] = typeof confirmedHf === 'number' ? confirmedHf : null
        setForm(next)
      } else {
        setForm(blank())
      }

      // El éxito se muestra antes de desbloquear el botón para evitar doble carga
      // y para que el operador vea una confirmación inequívoca del servidor.
      setMsg('REGISTRO GUARDADO CORRECTAMENTE. El registro ya está confirmado en la planilla y disponible para otros dispositivos. El comprobante queda disponible en Comprobantes.')
      setSaving(false)

      // Limpieza local y refresco global en segundo plano: no hacen esperar al operador.
      void db.syncQueue.delete(item.id)
        .then(() => reloadPending())
        .catch(() => undefined)

      void (async () => {
        try {
          const fresh = await getBootstrapLive()
          setData(fresh)
          await db.catalogs.put({ key: 'bootstrap', value: fresh })
        } catch { /* el registro ya quedó confirmado; se refrescará más adelante */ }
      })()`

      if (!code.includes(before)) {
        throw new Error('No se encontró el bloque de posguardado esperado en src/App.tsx. Revisar instant-save-feedback-vite-plugin.ts.')
      }

      let transformed = code.replace(before, after)

      const initialMessage = '<p>La primera apertura requiere internet.</p>'
      const welcomeMessage = '<p>Bienvenido a la aplicación de Registro de Operaciones de DELTA MINING.</p>'
      if (!transformed.includes(initialMessage)) {
        throw new Error('No se encontró el mensaje inicial esperado en src/App.tsx.')
      }
      transformed = transformed.replace(initialMessage, welcomeMessage)

      return {
        code: transformed,
        map: null
      }
    }
  }
}
