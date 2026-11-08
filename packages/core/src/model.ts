import { z } from 'zod';

/**
 * Modelo de dados do CuePoint (PRD §6). Cada entidade sincronizada é um registro plano com:
 * - `id` e os campos de domínio (inclusive `deleted_at`, o tombstone);
 * - `created_at` / `updated_at` (ISO, derivados das operações);
 * - metadados de mesclagem `_v` (versões por campo) e `_c` (candidatos em conflito).
 */

const id = z.uuid();
const isoOrNull = z.iso.datetime().nullable();

export const trackSchema = z.object({
  soundcloud_urn: z
    .string()
    .regex(/^soundcloud:tracks:\d+$/)
    .nullable(),
  soundcloud_url: z.url().nullable(),
  title: z.string().min(1),
  artist: z.string(),
  artwork_url: z.url().nullable(),
  /** Origem da identificação: dom, mediasession, manual, android, import. */
  metadata_source: z.string().min(1),
  /** Faixa provisória associada a uma definitiva (PRD §8.2). */
  merged_into: id.nullable(),
  deleted_at: isoOrNull,
});

export const researchSchema = z.object({
  user_id: id,
  name: z.string().trim().min(1),
  description: z.string(),
  archived: z.boolean(),
  deleted_at: isoOrNull,
});

export const decisionSchema = z.object({
  user_id: id,
  track_id: id,
  research_id: id,
  decision: z.boolean(),
  device_source: z.string().min(1),
  deleted_at: isoOrNull,
});

export const categorySchema = z.object({
  user_id: id,
  name: z.string().trim().min(1),
  description: z.string(),
  deleted_at: isoOrNull,
});

export const trackCategorySchema = z.object({
  track_id: id,
  research_id: id,
  category_id: id,
  deleted_at: isoOrNull,
});

export const playlistSchema = z.object({
  user_id: id,
  name: z.string().trim().min(1),
  description: z.string(),
  research_id: id.nullable(),
  category_id: id.nullable(),
  external_playlist_id: z.string().nullable(),
  deleted_at: isoOrNull,
});

export const playlistTrackSchema = z.object({
  playlist_id: id,
  track_id: id,
  /** Chave fracionária (ordenação lexicográfica). */
  position: z.string().min(1),
  deleted_at: isoOrNull,
});

export const ENTITY_SCHEMAS = {
  track: trackSchema,
  research: researchSchema,
  decision: decisionSchema,
  category: categorySchema,
  track_category: trackCategorySchema,
  playlist: playlistSchema,
  playlist_track: playlistTrackSchema,
} as const;

export type EntityType = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_TYPES = Object.keys(ENTITY_SCHEMAS) as EntityType[];

export type TrackData = z.infer<typeof trackSchema>;
export type ResearchData = z.infer<typeof researchSchema>;
export type DecisionData = z.infer<typeof decisionSchema>;
export type CategoryData = z.infer<typeof categorySchema>;
export type TrackCategoryData = z.infer<typeof trackCategorySchema>;
export type PlaylistData = z.infer<typeof playlistSchema>;
export type PlaylistTrackData = z.infer<typeof playlistTrackSchema>;

export interface EntityDataMap {
  track: TrackData;
  research: ResearchData;
  decision: DecisionData;
  category: CategoryData;
  track_category: TrackCategoryData;
  playlist: PlaylistData;
  playlist_track: PlaylistTrackData;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** Valor de um campo em conflito. */
export interface Candidate {
  hlc: string;
  origin: string;
  value: JsonValue;
}

/** Metadados de mesclagem guardados em cada registro. */
export interface MergeMeta {
  id: string;
  created_at: string;
  updated_at: string;
  /** Fronteira de versões (HLCs) por campo. Mais de uma = escritas concorrentes. */
  _v: Record<string, string[]>;
  /** Candidatos por campo quando a fronteira tem mais de uma versão. */
  _c?: Record<string, Candidate[]>;
}

export type EntityRecord<T extends EntityType = EntityType> = EntityDataMap[T] & MergeMeta;

export type Track = EntityRecord<'track'>;
export type Research = EntityRecord<'research'>;
export type Decision = EntityRecord<'decision'>;
export type Category = EntityRecord<'category'>;
export type TrackCategory = EntityRecord<'track_category'>;
export type Playlist = EntityRecord<'playlist'>;
export type PlaylistTrack = EntityRecord<'playlist_track'>;

/**
 * Campos "last-writer-wins": metadados informativos que nunca geram conflito
 * (ex.: qual aparelho registrou a decisão, ou metadados lidos automaticamente da faixa,
 * que podem vir formatados de modo diferente no Chrome e no Android).
 */
export const LWW_FIELDS: Partial<Record<EntityType, readonly string[]>> = {
  decision: ['device_source'],
  track: ['title', 'artist', 'soundcloud_url', 'artwork_url', 'metadata_source'],
};

export function isLwwField(type: EntityType, field: string): boolean {
  return LWW_FIELDS[type]?.includes(field) ?? false;
}

/** Campos de domínio de uma entidade (inclui `deleted_at`). */
export function entityFields(type: EntityType): string[] {
  return Object.keys(ENTITY_SCHEMAS[type].shape);
}

export const SYSTEM_FIELDS = new Set(['id', 'created_at', 'updated_at', '_v', '_c']);

/** Valida os dados de domínio de um registro (regras de integridade do PRD §6.2). */
export function validateEntity<T extends EntityType>(type: T, data: unknown): EntityDataMap[T] {
  return ENTITY_SCHEMAS[type].parse(data) as EntityDataMap[T];
}

/** Usuário local (PRD §4.1: sem conta no MVP; preparado para multiusuário). */
export interface User {
  id: string;
  created_at: string;
}

export type SyncPolicy = 'auto' | 'ask';
export type PairingStatus = 'self' | 'pending' | 'paired' | 'revoked';

/** Dispositivo (PRD §4.3). O próprio aparelho tem `pairing_status = 'self'`. */
export interface Device {
  id: string;
  user_id: string;
  device_name: string;
  public_key: string | null;
  pairing_status: PairingStatus;
  sync_policy: SyncPolicy;
  created_at: string;
  last_sync_at: string | null;
}
