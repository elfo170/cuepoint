import { applyOp, conflictFields } from './merge';
import type { EntityRecord } from './model';
import { compareOps, opId, type Op, type OpKind } from './ops';

/**
 * Compactação de operações ainda não enviadas a nenhum aparelho (opção B).
 *
 * Operações pendentes do mesmo registro viram uma só, com o estado final: os valores mais
 * recentes de cada campo, o HLC da última e, como base de cada campo, a união das bases
 * originais menos as versões das próprias operações compactadas. As sequências são renumeradas
 * a partir de `fromSeq`, sem lacunas. Os passos intermediários não são preservados (PRD §6.3).
 *
 * Pré-condição: `ops` são do mesmo aparelho, consecutivas e nenhuma foi enviada.
 */
export function compactOps(ops: Op[], fromSeq: number): Op[] {
  if (ops.length < 2) return ops;
  const origin = ops[0]!.origin;
  const own = new Set(ops.map((o) => o.hlc));
  const groups = new Map<string, Op[]>();
  for (const op of [...ops].sort((a, b) => a.seq - b.seq)) {
    if (op.origin !== origin) throw new Error('compactação exige operações de uma só origem');
    const key = `${op.entity_type}:${op.entity_id}`;
    groups.set(key, [...(groups.get(key) ?? []), op]);
  }
  const merged = [...groups.values()].map((list): Op => {
    const last = list[list.length - 1]!;
    const fields: Op['fields'] = {};
    const base: Record<string, Set<string>> = {};
    for (const op of list) {
      for (const [field, value] of Object.entries(op.fields)) {
        fields[field] = value;
        base[field] ??= new Set();
        for (const h of op.base[field] ?? []) if (!own.has(h)) base[field].add(h);
      }
    }
    const kinds = list.map((o) => o.operation);
    const operation: OpKind = kinds.includes('resolve')
      ? 'resolve'
      : kinds[0] === 'create'
        ? 'create'
        : last.operation === 'delete'
          ? 'delete'
          : 'update';
    return {
      ...last,
      operation,
      fields,
      base: Object.fromEntries(Object.entries(base).map(([f, s]) => [f, [...s].sort()])),
    };
  });
  return merged.sort(compareOps).map((op, i) => ({
    ...op,
    seq: fromSeq + i,
    op_id: opId(origin, fromSeq + i),
  }));
}

export interface RebuiltState {
  records: Map<string, EntityRecord>;
  conflicts: { entity_type: string; entity_id: string; field: string }[];
}

/** Recalcula todos os registros reaplicando o log inteiro em ordem de HLC. */
export function rebuildFromLog(log: Op[]): RebuiltState {
  const records = new Map<string, EntityRecord>();
  for (const op of [...log].sort(compareOps)) {
    const key = `${op.entity_type}:${op.entity_id}`;
    records.set(key, applyOp(op.entity_type, records.get(key), op).record);
  }
  const conflicts = [...records.entries()].flatMap(([key, rec]) =>
    conflictFields(rec).map((field) => ({
      entity_type: key.split(':')[0]!,
      entity_id: rec.id,
      field,
    })),
  );
  return { records, conflicts };
}
