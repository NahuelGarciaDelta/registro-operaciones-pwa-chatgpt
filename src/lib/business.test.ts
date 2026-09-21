import { describe, expect, it } from 'vitest'
import { calcHours, estadoTexto, provisionalReference, tasksForEquipment } from './business'

describe('ROP02 business rules', () => {
  it('maps OD/FS/EM', () => {
    expect(estadoTexto('OD')).toBe('Equipo operativo a disposición')
    expect(estadoTexto('FS')).toBe('Equipo fuera de servicio')
    expect(estadoTexto('EM')).toBe('Equipo en mantenimiento programado')
  })
  it('filters tasks', () => {
    expect(tasksForEquipment([{id:'1',tipoEquipo:'Motoniveladora',tarea:'Perfilado'},{id:'2',tipoEquipo:'Topadora',tarea:'Ripeado'}], 'Motoniveladora')).toHaveLength(1)
  })
  it('uses last part and HF', () => {
    const ref = provisionalReference('CAV-0114-JM', [{interno:'CAV-0114-JM',ultimoNumeroParte:273,ultimoHorometroFinal:1763,fechaUltimoRegistro:'2026-09-18'}], [])
    expect(ref.parte).toBe(274)
    expect(ref.hi).toBe(1763)
  })
  it('calculates hours', () => expect(calcHours(1763,1771)).toBe(8))
})
