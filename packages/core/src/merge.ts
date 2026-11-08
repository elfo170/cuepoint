import { hlcToIso, parseHlc } from './hlc';
import {
  isLwwField,
  SYSTEM_FIELDS,
  type Candidate,
  type EntityRecord,
  type EntityType,
  type JsonValue,
} from './model';
import type { Op } from './ops';

/**
 * Motor de mesclagem por campo.
 *
 * Cada campo guarda a fronteira de versões (`_v[campo]`). Uma operação traz, por campo escrito,
 * a fronteira que o autor via (`base`):
 * - se a base cobre toda a fronteira local, a escrita a substitui (avanço direto ou resolução);
 * - senão as escritas são concorrentes: a fronteira passa a ter vários candidatos (`_c`). Se os
 *   valores divergem, o campo fica em conflito até o usuário resolver; enquanto isso vale o
 *   candidato de maior HLC (determinístico em todas as réplicas).
 *
 * Campos LWW (metadados) usam "maior HLC vence" e nunca geram conflito.
 * Pré-condição: entrega causal (operações aplicadas em ordem de HLC, sem lacunas por origem).
 */

export function canonicalJson(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** Equivalência de valores para fins de conflito. Exclusões concorrentes nunca conflitam. */
export function valuesEquivalent(field: string, a: JsonValue, b: JsonValue): boolean {
  if (field === 'deleted_at') return (a === null) === (b === null);
  return canonicalJson(a) === canonicalJson(b);
}

function originOf(hlc: string): string {
  return parseHlc(hlc).node;
}

/** Campos do registro em conflito (candidatos com valores divergentes). */
export function conflictFields(record: Pick<EntityRecord, '_c'>): string[] {
  const out: string[] = [];
  for (const [field, candidates] of Object.entries(record._c ?? {})) {
    const first = candidates[0]!;
    if (candidates.some((c) => !valuesEquivalent(field, c.value, first.value))) out.push(field);
  }
  return out.sort();
}

export interface ApplyResult<T extends EntityType = EntityType> {
  record: EntityRecord<T>;
  /** Campos que entraram ou saíram de conflito com esta operação. */
  conflictChanges: { field: string; conflicted: boolean }[];
}

/** Aplica uma operação a um registro (ou cria o registro). Não muta a entrada. */
export function applyOp<T extends EntityType>(
  type: T,
  current: EntityRecord<T> | undefined,
  op: Op,
): ApplyResult<T> {
  const at = hlcToIso(op.hlc);
  const rec = (
    current
      ? structuredClone(current)
      : { id: op.entity_id, created_at: at, updated_at: at, _v: {} }
  ) as Record<string, unknown> & EntityRecord<T>;
  const before = new Set(current ? conflictFields(current) : []);

  for (const [field, value] of Object.entries(op.fields)) {
    if (SYSTEM_FIELDS.has(field)) continue;
    const frontier = rec._v[field] ?? [];
    if (frontier.includes(op.hlc)) continue; // reentrega

    if (isLwwField(type, field)) {
      const top = frontier[frontier.length - 1];
      if (!top || op.hlc > top) {
        rec[field] = value;
        rec._v[field] = [op.hlc];
      }
      continue;
    }

    const base = op.base[field] ?? [];
    const existing: Candidate[] =
      rec._c?.[field] ??
      frontier.map((hlc) => ({ hlc, origin: originOf(hlc), value: rec[field] as JsonValue }));
    const incoming: Candidate = { hlc: op.hlc, origin: op.origin, value };
    const dominates = frontier.every((h) => base.includes(h));
    const next = (
      dominates ? [incoming] : [...existing.filter((c) => !base.includes(c.hlc)), incoming]
    ).sort((a, b) => (a.hlc < b.hlc ? -1 : 1));

    rec._v[field] = next.map((c) => c.hlc);
    rec[field] = next[next.length - 1]!.value;
    if (next.length > 1) {
      rec._c = { ...(rec._c ?? {}), [field]: next };
    } else if (rec._c?.[field]) {
      const { [field]: _removed, ...rest } = rec._c;
      if (Object.keys(rest).length) rec._c = rest;
      else delete rec._c;
    }
  }

  if (at < rec.created_at) rec.created_at = at;
  if (at > rec.updated_at) rec.updated_at = at;

  const after = new Set(conflictFields(rec));
  const conflictChanges: ApplyResult['conflictChanges'] = [];
  for (const f of after) if (!before.has(f)) conflictChanges.push({ field: f, conflicted: true });
  for (const f of before) if (!after.has(f)) conflictChanges.push({ field: f, conflicted: false });
  return { record: rec as EntityRecord<T>, conflictChanges };
}

/** Fronteira atual de cada campo, usada como `base` de uma nova operação local. */
export function baseFor(
  current: EntityRecord | undefined,
  fields: string[],
): Record<string, string[]> {
  const base: Record<string, string[]> = {};
  for (const f of fields) base[f] = [...(current?._v[f] ?? [])];
  return base;
}

/** Dados de domínio do registro, sem metadados de mesclagem. */
export function stripMeta<T extends EntityType>(record: EntityRecord<T>): Record<string, unknown> {
  const {
    _v: _versions,
    _c: _candidates,
    ...rest
  } = record as EntityRecord & {
    _c?: unknown;
  };
  return rest;
}
