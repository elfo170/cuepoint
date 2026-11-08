import {
  createBackup,
  CUEPOINT_SCHEMA_VERSION,
  ENTITY_TYPES,
  parseHlc,
  type Backup,
  type BackupData,
  type EntityRecord,
  type EntityType,
  type JsonValue,
} from '@cuepoint/core';
import type { SyncEventRow } from './db';
import type { Store } from './store';

export interface BackupSettings {
  /** Intervalo do backup automático, em horas (0 = desligado). */
  intervalHours: number;
  /** Faz backup também a cada N alterações (0 = desligado). */
  everyChanges: number;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { intervalHours: 24, everyChanges: 100 };

export interface BackupRecord {
  at: string;
  filename: string;
  ops: number;
  sha256: string;
  bytes: number;
  reason: 'auto' | 'manual' | 'pre-restore';
}

/** Monta o backup completo do IndexedDB. */
export async function buildBackup(store: Store): Promise<Backup> {
  const { user, device } = await store.init();
  const db = store.db;
  const entities = {} as Record<EntityType, EntityRecord[]>;
  for (const type of ENTITY_TYPES)
    entities[type] = (await db.entityTable(type).toArray()) as EntityRecord[];
  const rows = await db.sync_events.orderBy('hlc').toArray();
  const data: BackupData = {
    entities,
    ops: rows.map(({ device_id: _d, timestamp: _t, synchronization_status: _s, ...op }) => op),
    users: await db.users.toArray(),
    devices: (await db.devices.toArray()) as unknown as Record<string, JsonValue>[],
    conflicts: (await db.conflicts.toArray()) as unknown as Record<string, JsonValue>[],
    settings: {
      activeResearchId: ((await store.getMeta<string | null>('activeResearchId')) ??
        null) as JsonValue,
    },
  };
  return createBackup({
    data,
    deviceId: device.id,
    userId: user.id,
    schemaVersion: CUEPOINT_SCHEMA_VERSION,
  });
}

export function backupFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `cuepoint-backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(
    date.getHours(),
  )}${p(date.getMinutes())}${p(date.getSeconds())}.json`;
}

/**
 * Restaura um backup já validado, substituindo todo o conteúdo do IndexedDB numa única transação
 * (tudo ou nada). Adota a identidade (usuário/dispositivo) do backup e reposiciona o relógio para
 * continuar a sequência de operações deste aparelho sem lacunas.
 */
export async function restoreBackup(store: Store, backup: Backup): Promise<void> {
  const db = store.db;
  const { data } = backup;
  const tables = [...db.writeTables, db.users, db.devices];
  await db.transaction('rw', tables, async () => {
    const activeResearchId = data.settings.activeResearchId ?? null;
    for (const t of tables) await t.clear();
    for (const type of ENTITY_TYPES) await db.entityTable(type).bulkPut(data.entities[type]);
    await db.sync_events.bulkPut(
      data.ops.map((op): SyncEventRow => ({
        ...op,
        device_id: op.origin,
        timestamp: new Date(parseHlc(op.hlc).ms).toISOString(),
        synchronization_status: op.origin === backup.device_id ? 'local_pending' : 'received',
      })),
    );
    await db.users.bulkPut(data.users);
    await db.devices.bulkPut(data.devices as never[]);
    await db.conflicts.bulkPut(data.conflicts as never[]);
    const own = data.ops.filter((o) => o.origin === backup.device_id);
    const lastHlc = data.ops.reduce<string | null>((m, o) => (!m || o.hlc > m ? o.hlc : m), null);
    await db.meta.bulkPut([
      { key: 'identity', value: { userId: backup.user_id, deviceId: backup.device_id } },
      {
        key: 'clock',
        value: {
          last: lastHlc ? lastHlc.replace(/:[^:]+$/, `:${backup.device_id}`) : null,
          seq: own.reduce((m, o) => Math.max(m, o.seq), 0),
        },
      },
      { key: 'activeResearchId', value: activeResearchId },
    ]);
  });
  store.resetIdentity();
}

/** Conta operações ainda não cobertas pelo último backup. */
export async function changesSinceLastBackup(store: Store): Promise<number> {
  const lastOps = (await store.getMeta<number>('backup.lastOps')) ?? 0;
  return (await store.db.sync_events.count()) - lastOps;
}

export async function recordBackup(store: Store, record: BackupRecord): Promise<void> {
  const history = (await store.getMeta<BackupRecord[]>('backup.history')) ?? [];
  await store.setMeta('backup.history', [record, ...history].slice(0, 200));
  await store.setMeta('backup.lastOps', record.ops);
  await store.setMeta('backup.lastAt', record.at);
}

export async function getBackupSettings(store: Store): Promise<BackupSettings> {
  return {
    ...DEFAULT_BACKUP_SETTINGS,
    ...((await store.getMeta<BackupSettings>('backup.settings')) ?? {}),
  };
}
