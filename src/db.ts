import Dexie, { type Table } from 'dexie'
import type { BootstrapData, PendingRecord, Rop02Record } from './types'

interface CatalogRow { key: string; value: BootstrapData }
interface SyncedRow { id: string; payload: Rop02Record; syncedAt: string }

class RopDb extends Dexie {
  catalogs!: Table<CatalogRow, string>
  syncQueue!: Table<PendingRecord, string>
  syncedRecords!: Table<SyncedRow, string>
  constructor() {
    super('delta-rop02')
    this.version(1).stores({ catalogs: 'key', syncQueue: 'id,createdAt,syncStatus', syncedRecords: 'id,syncedAt' })
    // Limpieza única de pendientes de la primera etapa de pruebas.
    this.version(2)
      .stores({ catalogs: 'key', syncQueue: 'id,createdAt,syncStatus', syncedRecords: 'id,syncedAt' })
      .upgrade(tx => tx.table('syncQueue').clear())
    // Segunda limpieza única solicitada durante las pruebas actuales.
    // Corre una sola vez por dispositivo al abrir esta versión y no afecta pendientes futuros.
    this.version(3)
      .stores({ catalogs: 'key', syncQueue: 'id,createdAt,syncStatus', syncedRecords: 'id,syncedAt' })
      .upgrade(tx => tx.table('syncQueue').clear())
    // Limpieza puntual solicitada: elimina únicamente el pendiente de Almonacid Gabriel,
    // MOT-0090-JM, parte 23, José María. No afecta ningún otro registro pendiente.
    this.version(4)
      .stores({ catalogs: 'key', syncQueue: 'id,createdAt,syncStatus', syncedRecords: 'id,syncedAt' })
      .upgrade(async tx => {
        const queue = tx.table('syncQueue')
        const rows = await queue.toArray()
        const normalize = (value: unknown) => String(value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLocaleLowerCase('es')
        const targets = rows.filter((row: PendingRecord) =>
          normalize(row.payload.Interno) === 'mot-0090-jm'
          && normalize(row.payload.Operador) === 'almonacid gabriel'
          && row.payload['N° Parte'] === 23
          && normalize(row.payload.Proyecto) === 'jose maria'
        )
        await Promise.all(targets.map((row: PendingRecord) => queue.delete(row.id)))
      })
  }
}
export const db = new RopDb()
