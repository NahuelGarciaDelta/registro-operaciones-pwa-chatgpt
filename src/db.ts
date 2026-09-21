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
  }
}
export const db = new RopDb()
