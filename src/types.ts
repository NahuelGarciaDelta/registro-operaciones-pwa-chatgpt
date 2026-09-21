export type EstadoEquipo = '' | 'OD' | 'FS' | 'EM'
export type Proyecto = 'JOSE MARIA' | 'FILO DEL SOL'

export interface Equipment { id: string; equipo: string }
export interface Task { id: string; tipoEquipo: string; tarea: string }
export interface EquipmentState {
  interno: string
  ultimoNumeroParte: number | null
  ultimoHorometroFinal: number | null
  fechaUltimoRegistro: string | null
  ultimoTurno: string | null
}
export interface ProjectCatalog {
  equipos: Equipment[]
  supervisoresDelta: string[]
  supervisoresCliente: string[]
  equipmentState: EquipmentState[]
}
export interface BootstrapData {
  generatedFrom?: string
  generatedAt?: string
  project: string
  projects?: Proyecto[]
  projectCatalogs?: Partial<Record<Proyecto, ProjectCatalog>>
  // Campos legacy para mantener compatibilidad con bootstrap.json y cachés antiguas de JM.
  equipos: Equipment[]
  operadores: string[]
  supervisoresDelta: string[]
  supervisoresCliente: string[]
  tareas: Task[]
  unidades: string[]
  areas: string[]
  equipmentState: EquipmentState[]
}

export interface Rop02Record {
  ID: string
  Fecha: string
  Interno: string
  Equipo: string
  Operador: string
  'Supervisor Delta': string
  'Supervisor Vial Cliente': string
  'Turno de trabajo': string
  'N° Parte': number | null
  Proyecto: string
  'Area de trabajo': string
  'Horómetro inicial': number | null
  'Horómetro final': number | null
  'Cant. Hs.': number | null
  'OD o FS': EstadoEquipo
  Combustible: string
  Aceite: string
  'Tarea 1': string
  'Tarea 2': string
  'Información sobre Desgaste': string
  'Observaciones 1': string
  'Observaciones 2': string
  'Cambio de tareas planificadas': string
  Firma?: string
}

export interface PendingRecord {
  id: string
  payload: Rop02Record
  signatureDataUrl?: string
  createdAt: string
  updatedAt: string
  syncStatus: 'pending' | 'syncing' | 'error'
  syncAttempts: number
  lastSyncError?: string
}
