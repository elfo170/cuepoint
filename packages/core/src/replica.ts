import { compactOps, rebuildFromLog } from './compaction';
import { HlcClock } from './hlc';
import { applyOp, baseFor, conflictFields } from './merge';
import {
  validateEntity,
  type EntityDataMap,
  type EntityRecord,
  type EntityType,
  type JsonValue,
} from './model';
import {
  assertSameUser,
  compareOps,
  opId,
  opsMissingFrom,
  type Op,
  type OpKind,
  type VersionVector,
} from './ops';

export class CausalityError extends Error {}

/** Monta uma operação local a partir das alterações desejadas. */
export function buildLocalOp<T extends EntityType>(params: {
  type: T;
  id: string;
  current: EntityRecord<T> | undefined;
  changes: Partial<EntityDataMap[T]>;
  origin: string;
  seq: number;
  hlc: string;
  userId: string;
  operation?: OpKind;
  /**
   * Escrita que não viu o estado atual (base vazia): se o valor divergir, vira conflito em vez
   * de sobrescrever. Usada ao reapontar dados de uma faixa provisória para a definitiva.
   */
  concurrent?: boolean;
}): Op {
  const { type, id, current, origin, seq, hlc, userId } = params;
  const fields = { ...(params.changes as Record<string, JsonValue>) };
  // Toda escrita afirma que o registro está vivo, exceto a própria exclusão. Assim,
  // "editar × excluir" concorrentes viram conflito em vez de perda silenciosa. A resolução de
  // conflito grava só o campo escolhido: resolver um campo não pode ressuscitar um registro
  // excluído nem decidir, por tabela, um conflito de exclusão.
  if (!('deleted_at' in fields) && params.operation !== 'resolve') fields.deleted_at = null;
  const merged = { ...(current ?? {}), ...fields };
  const { _v, _c, id: _id, created_at, updated_at, ...data } = merged as Record<string, unknown>;
  void _v;
  void _c;
  void _id;
  void created_at;
  void updated_at;
  validateEntity(type, data);
  const operation: OpKind =
    params.operation ?? (!current ? 'create' : fields.deleted_at !== null ? 'delete' : 'update');
  return {
    op_id: opId(origin, seq),
    origin,
    seq,
    hlc,
    user_id: userId,
    entity_type: type,
    entity_id: id,
    operation,
    fields,
    base: params.concurrent
      ? Object.fromEntries(Object.keys(fields).map((f) => [f, [] as string[]]))
      : baseFor(current, Object.keys(fields)),
  };
}

export interface ConflictInfo {
  entity_type: EntityType;
  entity_id: string;
  field: string;
}

/**
 * Réplica em memória: implementação de referência do armazenamento + log de operações.
 * Usada nos testes, nos vetores compartilhados e como modelo para os repositórios reais.
 */
export class Replica {
  readonly records = new Map<string, EntityRecord>();
  log: Op[] = [];
  /** Maior seq próprio já enviado a algum aparelho (não pode mais ser compactado). */
  sentSeq = 0;
  readonly vv: VersionVector = {};
  readonly clock: HlcClock;
  private seq = 0;

  constructor(
    readonly deviceId: string,
    readonly userId: string,
    now: () => number = Date.now,
  ) {
    this.clock = new HlcClock(deviceId, null, now);
  }

  static key(type: EntityType, id: string): string {
    return `${type}:${id}`;
  }

  get<T extends EntityType>(type: T, id: string): EntityRecord<T> | undefined {
    return this.records.get(Replica.key(type, id)) as EntityRecord<T> | undefined;
  }

  all<T extends EntityType>(type: T): EntityRecord<T>[] {
    return [...this.records.entries()]
      .filter(([k]) => k.startsWith(`${type}:`))
      .map(([, r]) => r as unknown as EntityRecord<T>);
  }

  /** Cria ou altera um registro localmente. */
  put<T extends EntityType>(
    type: T,
    id: string,
    changes: Partial<EntityDataMap[T]>,
    operation?: OpKind,
    opts: { concurrent?: boolean } = {},
  ): Op {
    const op = buildLocalOp({
      type,
      id,
      current: this.get(type, id),
      changes,
      origin: this.deviceId,
      seq: this.seq + 1,
      hlc: this.clock.tick(),
      userId: this.userId,
      operation,
      concurrent: opts.concurrent,
    });
    this.seq += 1;
    this.applyAndLog(op);
    return op;
  }

  /** Exclusão explícita (tombstone, propagada aos demais aparelhos). */
  delete(type: EntityType, id: string): Op {
    return this.put(type, id, { deleted_at: new Date(this.clock.now()).toISOString() } as never);
  }

  /** Resolve um conflito escolhendo o valor final do campo. */
  resolve(type: EntityType, id: string, field: string, value: JsonValue): Op {
    return this.put(type, id, { [field]: value } as never, 'resolve');
  }

  /** Recebe operações remotas. Idempotente; exige entrega causal. Retorna quantas aplicou. */
  receive(ops: Op[]): number {
    assertSameUser(ops, this.userId);
    let applied = 0;
    for (const op of [...ops].sort(compareOps)) {
      const have = this.vv[op.origin] ?? 0;
      if (op.seq <= have) continue;
      if (op.seq !== have + 1) {
        throw new CausalityError(
          `lacuna em ${op.origin}: esperado ${have + 1}, recebido ${op.seq}`,
        );
      }
      this.clock.receive(op.hlc);
      this.applyAndLog(op);
      applied += 1;
    }
    return applied;
  }

  /** Registra que as operações próprias até `seq` foram enviadas. */
  markSent(seq: number): void {
    this.sentSeq = Math.max(this.sentSeq, seq);
  }

  /** Compacta as operações próprias ainda não enviadas. Retorna quantas operações sumiram. */
  compactPending(): number {
    const pending = this.log.filter((o) => o.origin === this.deviceId && o.seq > this.sentSeq);
    if (pending.length < 2) return 0;
    const compacted = compactOps(pending, this.sentSeq + 1);
    const pendingIds = new Set(pending.map((o) => o.op_id));
    this.log = [...this.log.filter((o) => !pendingIds.has(o.op_id)), ...compacted];
    const { records } = rebuildFromLog(this.log);
    this.records.clear();
    for (const [k, v] of records) this.records.set(k, v);
    this.seq = this.sentSeq + compacted.length;
    this.vv[this.deviceId] = this.seq;
    return pending.length - compacted.length;
  }

  /** Operações que faltam para quem tem o vetor `vv`. */
  opsSince(vv: VersionVector): Op[] {
    return opsMissingFrom(this.log, vv);
  }

  conflicts(): ConflictInfo[] {
    const out: ConflictInfo[] = [];
    for (const [key, rec] of this.records) {
      const [type] = key.split(':') as [EntityType];
      for (const field of conflictFields(rec))
        out.push({ entity_type: type, entity_id: rec.id, field });
    }
    return out.sort((a, b) =>
      `${a.entity_type}${a.entity_id}${a.field}`.localeCompare(
        `${b.entity_type}${b.entity_id}${b.field}`,
      ),
    );
  }

  private applyAndLog(op: Op): void {
    const key = Replica.key(op.entity_type, op.entity_id);
    const { record } = applyOp(op.entity_type, this.records.get(key), op);
    this.records.set(key, record);
    this.log.push(op);
    this.vv[op.origin] = op.seq;
  }
}

/** Sincronização completa nos dois sentidos entre duas réplicas (usada em testes). */
export function syncPair(a: Replica, b: Replica): void {
  b.receive(a.opsSince(b.vv));
  a.receive(b.opsSince(a.vv));
}
