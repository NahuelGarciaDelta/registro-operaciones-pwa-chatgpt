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
  it('uses last part, HF and previous shift', () => {
    const ref = provisionalReference('CAV-0114-JM', [{interno:'CAV-0114-JM',ultimoNumeroParte:273,ultimoHorometroFinal:1763,fechaUltimoRegistro:'2026-09-18',ultimoTurno:'TURNO DIA'}], [])
    expect(ref.parte).toBe(274)
    expect(ref.hi).toBe(1763)
    expect(ref.turnoAnterior).toBe('TURNO DIA')
  })
  it('uses pending shift before server shift', () => {
    const ref = provisionalReference('CAV-0114-JM', [{interno:'CAV-0114-JM',ultimoNumeroParte:273,ultimoHorometroFinal:1763,fechaUltimoRegistro:'2026-09-18',ultimoTurno:'TURNO DIA'}], [{
      id: '1',
      payload: {
        ID:'1', Fecha:'2026-09-19', Interno:'CAV-0114-JM', Equipo:'Camioneta', Operador:'Op',
        'Supervisor Delta':'Sup', 'Supervisor Vial Cliente':'Cli', 'Turno de trabajo':'TURNO NOCHE',
        'N° Parte':274, Proyecto:'JOSE MARIA', 'Area de trabajo':'Camino', 'Horómetro inicial':1763,
        'Horómetro final':1771, 'Cant. Hs.':8, 'OD o FS':'', Combustible:'Sin carga', Aceite:'Sin carga',
        'Tarea 1':'Trabajo', 'Tarea 2':'', 'Información sobre Desgaste':'Sin consumos',
        'Observaciones 1':'Obs', 'Observaciones 2':'', 'Cambio de tareas planificadas':'Sin cambio'
      },
      createdAt:'2026-09-19T22:00:00Z', updatedAt:'2026-09-19T22:00:00Z', syncStatus:'pending', syncAttempts:0
    }])
    expect(ref.turnoAnterior).toBe('TURNO NOCHE')
    expect(ref.parte).toBe(275)
  })
  it('calculates hours', () => expect(calcHours(1763,1771)).toBe(8))
})
