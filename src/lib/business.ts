import type { EstadoEquipo, EquipmentState, PendingRecord, Task } from '../types'

export const estadoTexto = (estado: EstadoEquipo): string => {
  if (estado === 'OD') return 'Equipo operativo a disposición'
  if (estado === 'FS') return 'Equipo fuera de servicio'
  if (estado === 'EM') return 'Equipo en mantenimiento programado'
  return ''
}

export const tasksForEquipment = (tasks: Task[], equipo: string) => tasks.filter(t => t.tipoEquipo === equipo)

export function provisionalReference(interno: string, states: EquipmentState[], pending: PendingRecord[]) {
  const server = states.find(s => s.interno === interno)
  const local = pending
    .filter(p => p.payload.Interno === interno)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1)?.payload

  if (local) {
    return {
      parte: local['N° Parte'] == null ? null : local['N° Parte'] + 1,
      hi: local['Horómetro final'],
      // Para autorizar TURNO NOCHE manda siempre el último turno confirmado en la planilla.
      // Un pendiente local nunca habilita otro TURNO NOCHE.
      turnoAnterior: server?.ultimoTurno ?? null,
      source: 'local' as const
    }
  }

  return {
    parte: server?.ultimoNumeroParte == null ? null : server.ultimoNumeroParte + 1,
    hi: server?.ultimoHorometroFinal ?? null,
    turnoAnterior: server?.ultimoTurno ?? null,
    source: server ? 'sync' as const : 'none' as const
  }
}

export const calcHours = (hi: number | null, hf: number | null) => hi == null || hf == null ? null : Number((hf - hi).toFixed(2))
