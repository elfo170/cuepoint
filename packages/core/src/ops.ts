import { z } from 'zod';
import { deterministicId } from './ids';
import { ENTITY_TYPES, type EntityType, type JsonValue } from './model';

/**
 * Operação do log (SyncEvents, PRD §6.1). É a unidade de sincronização: idempotente
 * (identificada por `origin` + `seq`) e ordenável por `hlc`.
 */
export interface Op {
  /** Derivado de origin+seq: `uuidv5("op:<origin>:<seq>")`. */
  op_id: string;
  /** Dispositivo que criou a operação. */
  origin: string;
  /** Sequência por dispositivo, começando em 1, sem lacunas. */
  seq: number;
  hlc: string;
  user_id: string;
  entity_type: EntityType;
  entity_id: string;
  /** Informativo (o motor de mesclagem trata todas igualmente). */
  operation: OpKind;
  /** Valores escritos. */
  fields: Record<string, JsonValue>;
  /** Fronteira de versões que o autor via, por campo escrito. */
  base: Record<string, string[]>;
}

export type OpKind = 'create' | 'update' | 'delete' | 'resolve';

export function opId(origin: string, seq: number): string {
  return deterministicId(`op:${origin}:${seq}`);
}

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const opSchema = z.object({
  op_id: z.uuid(),
  origin: z.string().min(1),
  seq: z.number().int().positive(),
  hlc: z.string().regex(/^\d{15}:\d{6}:[^:]+$/),
  user_id: z.uuid(),
  entity_type: z.enum(ENTITY_TYPES as [EntityType, ...EntityType[]]),
  entity_id: z.uuid(),
  operation: z.enum(['create', 'update', 'delete', 'resolve']),
  fields: z.record(z.string(), jsonValue),
  base: z.record(z.string(), z.array(z.string())),
});

/** Valida uma operação recebida (estrutura e id derivado). */
export function validateOp(value: unknown): Op {
  const op = opSchema.parse(value) as Op;
  if (op.op_id !== opId(op.origin, op.seq)) throw new Error(`op_id inconsistente em ${op.op_id}`);
  return op;
}

/** Mensagem única (TS e Kotlin) para bibliotecas de usuários diferentes. */
export const FOREIGN_USER_MESSAGE =
  'Os aparelhos são de usuários diferentes. Para parear, apague a biblioteca do aparelho novo ou restaure nele um backup deste aparelho.';

/** Operação (ou pareamento) de outro usuário: recusada inteira, nada é aplicado. */
export class ForeignUserError extends Error {
  readonly code = 'foreign_user';
  constructor(message = FOREIGN_USER_MESSAGE) {
    super(message);
    this.name = 'ForeignUserError';
  }
}

/**
 * Isolamento por usuário (PRD §16): a operação pertence a `userId`. Confere o autor (`user_id`
 * da operação) e, se a operação escreve o campo `user_id` do registro, o valor escrito.
 */
export function isSameUser(op: Pick<Op, 'user_id' | 'fields'>, userId: string): boolean {
  if (op.user_id !== userId) return false;
  const written = op.fields.user_id;
  return written === undefined || written === userId;
}

/** Recusa o lote inteiro se alguma operação for de outro usuário. */
export function assertSameUser(ops: readonly Pick<Op, 'user_id' | 'fields'>[], userId: string) {
  if (ops.some((op) => !isSameUser(op, userId))) throw new ForeignUserError();
}

/** Vetor de versões: maior `seq` aplicado de cada origem. */
export type VersionVector = Record<string, number>;

export function compareOps(a: Op, b: Op): number {
  return a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0;
}

/** Operações que o detentor de `vv` ainda não tem, em ordem causal (HLC). */
export function opsMissingFrom(log: Iterable<Op>, vv: VersionVector): Op[] {
  const out: Op[] = [];
  for (const op of log) if (op.seq > (vv[op.origin] ?? 0)) out.push(op);
  return out.sort(compareOps);
}

export function mergeVersionVectors(a: VersionVector, b: VersionVector): VersionVector {
  const out: VersionVector = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}
