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
  }
}
export const db = new RopDb()
