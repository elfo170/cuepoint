import { z } from 'zod';
import { canonicalJson } from './merge';
import {
  ENTITY_SCHEMAS,
  ENTITY_TYPES,
  type EntityRecord,
  type EntityType,
  type JsonValue,
} from './model';
import { validateOp, type Op } from './ops';

/**
 * Formato de backup `cuepoint-backup` v1 (PRD §5.8, §16 Portabilidade).
 * Contém todas as entidades (inclusive tombstones e metadados de mesclagem), o log de operações,
 * usuários, dispositivos e um SHA-256 do conteúdo canônico para detectar corrupção.
 */
export const BACKUP_FORMAT = 'cuepoint-backup';
export const BACKUP_VERSION = 1;

export interface BackupData {
  entities: Record<EntityType, EntityRecord[]>;
  ops: Op[];
  users: { id: string; created_at: string }[];
  devices: Record<string, JsonValue>[];
  conflicts: Record<string, JsonValue>[];
  settings: Record<string, JsonValue>;
}

export interface BackupBody {
  format: typeof BACKUP_FORMAT;
  version: number;
  schema_version: number;
  created_at: string;
  device_id: string;
  user_id: string;
  counts: Record<string, number>;
  data: BackupData;
}

export interface Backup extends BackupBody {
  sha256: string;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function backupCounts(data: BackupData): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of ENTITY_TYPES) counts[t] = data.entities[t]?.length ?? 0;
  counts.ops = data.ops.length;
  return counts;
}

export async function createBackup(params: {
  data: BackupData;
  deviceId: string;
  userId: string;
  schemaVersion: number;
  now?: Date;
}): Promise<Backup> {
  // Normaliza via JSON (remove undefined) para o checksum bater após serializar/ler o arquivo.
  const data = JSON.parse(JSON.stringify(params.data)) as BackupData;
  const body: BackupBody = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema_version: params.schemaVersion,
    created_at: (params.now ?? new Date()).toISOString(),
    device_id: params.deviceId,
    user_id: params.userId,
    counts: backupCounts(data),
    data,
  };
  return { ...body, sha256: await sha256Hex(canonicalJson(body as unknown as JsonValue)) };
}

export class BackupError extends Error {}

const recordMeta = z.object({
  id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  _v: z.record(z.string(), z.array(z.string())),
});

/** Referências obrigatórias entre entidades: [tipo, campo, tipo referenciado, aceita null]. */
const REFERENCES: [EntityType, string, EntityType, boolean][] = [
  ['decision', 'track_id', 'track', false],
  ['decision', 'research_id', 'research', false],
  ['track_category', 'track_id', 'track', false],
  ['track_category', 'research_id', 'research', false],
  ['track_category', 'category_id', 'category', false],
  ['playlist', 'research_id', 'research', true],
  ['playlist', 'category_id', 'category', true],
  ['playlist_track', 'playlist_id', 'playlist', false],
  ['playlist_track', 'track_id', 'track', false],
  ['track', 'merged_into', 'track', true],
];

/**
 * Valida um backup antes de restaurar: formato, checksum, schema de cada registro, operações
 * e integridade referencial. Lança `BackupError` com uma mensagem legível.
 */
export async function validateBackup(input: unknown): Promise<Backup> {
  if (!input || typeof input !== 'object') throw new BackupError('Arquivo de backup inválido.');
  const b = input as Backup;
  if (b.format !== BACKUP_FORMAT) throw new BackupError('Não é um backup do CuePoint.');
  if (b.version !== BACKUP_VERSION)
    throw new BackupError(`Versão de backup não suportada: ${String(b.version)}.`);
  const { sha256, ...body } = b;
  const actual = await sha256Hex(canonicalJson(body as unknown as JsonValue));
  if (actual !== sha256) {
    throw new BackupError('Checksum não confere: o arquivo está corrompido ou foi alterado.');
  }
  const data = b.data;
  if (!data?.entities || !Array.isArray(data.ops)) throw new BackupError('Backup incompleto.');

  const ids = {} as Record<EntityType, Set<string>>;
  for (const type of ENTITY_TYPES) {
    const records = data.entities[type];
    if (!Array.isArray(records)) throw new BackupError(`Backup sem a tabela ${type}.`);
    ids[type] = new Set();
    for (const rec of records) {
      const meta = recordMeta.safeParse(rec);
      if (!meta.success) throw new BackupError(`Registro inválido em ${type}.`);
      const {
        id,
        created_at: _c,
        updated_at: _u,
        _v,
        _c: _cand,
        ...fields
      } = rec as EntityRecord & Record<string, unknown>;
      const parsed = ENTITY_SCHEMAS[type].safeParse(fields);
      if (!parsed.success) throw new BackupError(`Dados inválidos em ${type} ${id}.`);
      if (ids[type].has(id)) throw new BackupError(`Id duplicado em ${type}: ${id}.`);
      ids[type].add(id);
    }
  }
  for (const [type, field, target, nullable] of REFERENCES) {
    for (const rec of data.entities[type] as unknown as Record<string, unknown>[]) {
      const ref = rec[field] as string | null;
      if (ref === null && nullable) continue;
      if (!ids[target].has(ref as string)) {
        throw new BackupError(`Referência quebrada: ${type}.${field} → ${target} ${String(ref)}.`);
      }
    }
  }
  try {
    data.ops.forEach(validateOp);
  } catch {
    throw new BackupError('Log de operações inválido.');
  }
  return b;
}

export async function parseBackup(text: string): Promise<Backup> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError('O arquivo não é um JSON válido (pode estar truncado).');
  }
  return validateBackup(json);
}
