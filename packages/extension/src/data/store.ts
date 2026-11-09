import {
  applyOp,
  buildLocalOp,
  isNoopWrite,
  CausalityError,
  compactOps,
  ENTITY_TYPES,
  rebuildFromLog,
  conflictId,
  HlcClock,
  hlcToIso,
  newId,
  opsMissingFrom,
  validateOp,
  type Device,
  type EntityDataMap,
  type EntityRecord,
  type EntityType,
  type JsonValue,
  type Op,
  type OpKind,
  type User,
  type VersionVector,
} from '@cuepoint/core';
import { CuePointDB, type SyncEventRow } from './db';

export interface Identity {
  user: User;
  device: Device;
}

interface ClockState {
  last: string | null;
  seq: number;
}

export type ChangeListener = (types: Set<EntityType>) => void;

function defaultDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS/.test(ua)
      ? 'macOS'
      : /Linux/.test(ua)
        ? 'Linux'
        : 'PC';
  return `Chrome – ${os}`;
}

/**
 * Repositório local sobre o IndexedDB. Toda escrita grava, na mesma transação:
 * o registro mesclado, a operação no log (sync_events), o estado do relógio e os conflitos.
 */
export class Store {
  private identity: Identity | null = null;
  private listeners = new Set<ChangeListener>();

  constructor(readonly db: CuePointDB = new CuePointDB()) {}

  /** Cria (na primeira execução) e devolve a identidade local: usuário + dispositivo. */
  async init(): Promise<Identity> {
    if (this.identity) return this.identity;
    this.identity = await this.db.transaction(
      'rw',
      this.db.meta,
      this.db.users,
      this.db.devices,
      async () => {
        const existing = (await this.db.meta.get('identity'))?.value as
          { userId: string; deviceId: string } | undefined;
        if (existing) {
          const user = await this.db.users.get(existing.userId);
          const device = await this.db.devices.get(existing.deviceId);
          if (user && device) return { user, device };
        }
        const now = new Date().toISOString();
        const user: User = { id: newId(), created_at: now };
        const device: Device = {
          id: newId(),
          user_id: user.id,
          device_name: defaultDeviceName(),
          public_key: null,
          pairing_status: 'self',
          sync_policy: 'ask',
          created_at: now,
          last_sync_at: null,
        };
        await this.db.users.put(user);
        await this.db.devices.put(device);
        await this.db.meta.put({
          key: 'identity',
          value: { userId: user.id, deviceId: device.id },
        });
        await this.db.meta.put({
          key: 'clock',
          value: { last: null, seq: 0 } satisfies ClockState,
        });
        return { user, device };
      },
    );
    return this.identity;
  }

  /** Renomeia este aparelho (PRD §4.3). */
  async renameDevice(name: string): Promise<void> {
    const { device } = await this.init();
    const clean = name.trim();
    if (!clean) throw new Error('Informe um nome.');
    await this.db.devices.update(device.id, { device_name: clean });
    this.identity = null;
  }

  /** Esquece a identidade em cache (após restaurar um backup). */
  resetIdentity(): void {
    this.identity = null;
  }

  get deviceId(): string {
    if (!this.identity) throw new Error('Store.init() não foi chamado');
    return this.identity.device.id;
  }

  get userId(): string {
    if (!this.identity) throw new Error('Store.init() não foi chamado');
    return this.identity.user.id;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(types: Set<EntityType>) {
    for (const l of this.listeners) l(types);
  }

  async get<T extends EntityType>(type: T, id: string): Promise<EntityRecord<T> | undefined> {
    return (await this.db.entityTable(type).get(id)) as EntityRecord<T> | undefined;
  }

  /**
   * Aplica um lote de escritas locais numa única transação.
   * `fn` recebe `put` para registrar cada alteração; todas entram juntas ou nenhuma entra.
   */
  async write<R>(
    fn: (tx: {
      put: <T extends EntityType>(
        type: T,
        id: string,
        changes: Partial<EntityDataMap[T]>,
        operation?: OpKind,
      ) => Promise<EntityRecord<T>>;
      get: <T extends EntityType>(type: T, id: string) => Promise<EntityRecord<T> | undefined>;
    }) => Promise<R>,
  ): Promise<R> {
    await this.init();
    const touched = new Set<EntityType>();
    const result = await this.db.transaction('rw', this.db.writeTables, async () => {
      const clockRow = (await this.db.meta.get('clock'))?.value as ClockState | undefined;
      const state: ClockState = clockRow ?? { last: null, seq: 0 };
      const clock = new HlcClock(this.deviceId, state.last);
      const put = async <T extends EntityType>(
        type: T,
        id: string,
        changes: Partial<EntityDataMap[T]>,
        operation?: OpKind,
      ) => {
        const current = await this.get(type, id);
        // Escrita que não muda nada (ex.: aprovar o que já está aprovado) não gera operação.
        const fields = { ...(changes as Record<string, JsonValue>) };
        if (!('deleted_at' in fields)) fields.deleted_at = null;
        if (operation !== 'resolve' && isNoopWrite(current, fields)) return current!;
        state.seq += 1;
        const op = buildLocalOp({
          type,
          id,
          current,
          changes,
          origin: this.deviceId,
          seq: state.seq,
          hlc: clock.tick(),
          userId: this.userId,
          operation,
        });
        const record = await this.applyAndLog(op, 'local_pending');
        touched.add(type);
        return record as unknown as EntityRecord<T>;
      };
      const r = await fn({ put, get: (type, id) => this.get(type, id) });
      state.last = clock.last;
      await this.db.meta.put({ key: 'clock', value: state });
      return r;
    });
    if (touched.size) this.emit(touched);
    return result;
  }

  async put<T extends EntityType>(
    type: T,
    id: string,
    changes: Partial<EntityDataMap[T]>,
    operation?: OpKind,
  ): Promise<EntityRecord<T>> {
    return this.write((tx) => tx.put(type, id, changes, operation));
  }

  /** Exclusão explícita (tombstone propagável). */
  async remove(type: EntityType, id: string): Promise<void> {
    await this.put(type, id, { deleted_at: new Date().toISOString() } as never, 'delete');
  }

  /** Resolve o conflito de um campo escolhendo o valor final. */
  async resolve(type: EntityType, id: string, field: string, value: JsonValue): Promise<void> {
    await this.put(type, id, { [field]: value } as never, 'resolve');
  }

  /** Recebe operações de outro aparelho (entrega causal, idempotente). */
  async receive(ops: unknown[]): Promise<number> {
    await this.init();
    const validated = ops.map(validateOp).sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
    const touched = new Set<EntityType>();
    const applied = await this.db.transaction('rw', this.db.writeTables, async () => {
      const vv = await this.versionVector();
      const clockRow = (await this.db.meta.get('clock'))?.value as ClockState;
      const clock = new HlcClock(this.deviceId, clockRow.last);
      let count = 0;
      for (const op of validated) {
        const have = vv[op.origin] ?? 0;
        if (op.seq <= have) continue;
        if (op.seq !== have + 1)
          throw new CausalityError(
            `lacuna em ${op.origin}: esperado ${have + 1}, recebido ${op.seq}`,
          );
        clock.receive(op.hlc);
        await this.applyAndLog(op, 'received');
        vv[op.origin] = op.seq;
        touched.add(op.entity_type);
        count += 1;
      }
      await this.db.meta.put({ key: 'clock', value: { ...clockRow, last: clock.last } });
      return count;
    });
    if (touched.size) this.emit(touched);
    return applied;
  }

  /** Maior seq conhecido por origem. */
  async versionVector(): Promise<VersionVector> {
    const vv: VersionVector = {};
    await this.db.sync_events.orderBy('[origin+seq]').eachKey((key) => {
      const [origin, seq] = key as unknown as [string, number];
      vv[origin] = Math.max(vv[origin] ?? 0, seq);
    });
    return vv;
  }

  async opsSince(vv: VersionVector): Promise<Op[]> {
    const rows = await this.db.sync_events.toArray();
    return opsMissingFrom(rows, vv).map((op) => toOp(op as SyncEventRow));
  }

  /** Marca operações próprias como enviadas (não podem mais ser compactadas). */
  async markSent(ops: Op[]): Promise<void> {
    await this.init();
    const own = ops.filter((o) => o.origin === this.deviceId).map((o) => o.op_id);
    if (!own.length) return;
    await this.db.sync_events
      .where('op_id')
      .anyOf(own)
      .modify({ synchronization_status: 'local_sent' });
  }

  /**
   * Compacta as operações próprias ainda não enviadas (opção B): várias operações do mesmo
   * registro viram uma, com o estado final. Recalcula os registros a partir do log.
   * Retorna quantas operações deixaram de existir.
   */
  async compactPending(): Promise<number> {
    const { device } = await this.init();
    const removed = await this.db.transaction('rw', this.db.writeTables, async () => {
      const pending = (
        await this.db.sync_events.where('synchronization_status').equals('local_pending').toArray()
      )
        .filter((e) => e.origin === device.id)
        .sort((a, b) => a.seq - b.seq);
      if (pending.length < 2) return 0;
      const fromSeq = pending[0]!.seq;
      const later = await this.db.sync_events
        .where('[origin+seq]')
        .between([device.id, fromSeq], [device.id, Infinity])
        .count();
      if (later !== pending.length) return 0; // há operação enviada depois de uma pendente: não mexe
      const compacted = compactOps(pending.map(toOp), fromSeq);
      if (compacted.length === pending.length) return 0;
      await this.db.sync_events.bulkDelete(pending.map((p) => p.op_id));
      await this.db.sync_events.bulkAdd(
        compacted.map((op) => ({
          ...op,
          device_id: op.origin,
          timestamp: hlcToIso(op.hlc),
          synchronization_status: 'local_pending' as const,
        })),
      );
      const all = (await this.db.sync_events.toArray()).map(toOp);
      const { records, conflicts } = rebuildFromLog(all);
      for (const type of ENTITY_TYPES) await this.db.entityTable(type).clear();
      for (const [key, rec] of records) {
        await this.db.entityTable(key.split(':')[0] as EntityType).put(rec);
      }
      await this.db.conflicts.clear();
      for (const c of conflicts) {
        await this.db.conflicts.put({
          id: conflictId(c.entity_type, c.entity_id, c.field),
          entity_type: c.entity_type as EntityType,
          entity_id: c.entity_id,
          field: c.field,
          created_at: new Date().toISOString(),
        });
      }
      const clock = (await this.db.meta.get('clock'))?.value as ClockState;
      await this.db.meta.put({
        key: 'clock',
        value: { ...clock, seq: fromSeq + compacted.length - 1 },
      });
      return pending.length - compacted.length;
    });
    if (removed) this.emit(new Set(ENTITY_TYPES));
    return removed;
  }

  private async applyAndLog(op: Op, status: SyncEventRow['synchronization_status']) {
    const table = this.db.entityTable(op.entity_type);
    const current = (await table.get(op.entity_id)) as EntityRecord | undefined;
    const { record, conflictChanges } = applyOp(op.entity_type, current, op);
    await table.put(record);
    await this.db.sync_events.add({
      ...op,
      device_id: op.origin,
      timestamp: hlcToIso(op.hlc),
      synchronization_status: status,
    });
    for (const change of conflictChanges) {
      const id = conflictId(op.entity_type, op.entity_id, change.field);
      if (change.conflicted) {
        await this.db.conflicts.put({
          id,
          entity_type: op.entity_type,
          entity_id: op.entity_id,
          field: change.field,
          created_at: hlcToIso(op.hlc),
        });
      } else {
        await this.db.conflicts.delete(id);
      }
    }
    return record;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }
}

function toOp(row: SyncEventRow): Op {
  const { device_id: _d, timestamp: _t, synchronization_status: _s, ...op } = row;
  return op;
}
