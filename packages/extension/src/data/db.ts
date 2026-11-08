import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  Category,
  Decision,
  Device,
  EntityType,
  Op,
  Playlist,
  PlaylistTrack,
  Research,
  Track,
  TrackCategory,
  User,
} from '@cuepoint/core';

/** Linha da tabela sync_events: a operação + campos do PRD (SyncEvents). */
export interface SyncEventRow extends Op {
  device_id: string;
  timestamp: string;
  /** local_pending: criada aqui, ainda não enviada; received: veio de outro aparelho. */
  synchronization_status: 'local_pending' | 'local_sent' | 'received';
}

export interface ConflictRow {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  field: string;
  created_at: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export const ENTITY_TABLES = {
  track: 'tracks',
  research: 'researches',
  decision: 'decisions',
  category: 'categories',
  track_category: 'track_categories',
  playlist: 'playlists',
  playlist_track: 'playlist_tracks',
} as const satisfies Record<EntityType, string>;

export const DB_NAME = 'cuepoint';

export class CuePointDB extends Dexie {
  tracks!: EntityTable<Track, 'id'>;
  researches!: EntityTable<Research, 'id'>;
  decisions!: EntityTable<Decision, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  track_categories!: EntityTable<TrackCategory, 'id'>;
  playlists!: EntityTable<Playlist, 'id'>;
  playlist_tracks!: EntityTable<PlaylistTrack, 'id'>;
  sync_events!: Table<SyncEventRow, string>;
  conflicts!: EntityTable<ConflictRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  users!: EntityTable<User, 'id'>;
  devices!: EntityTable<Device, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      tracks: 'id, soundcloud_urn, soundcloud_url, merged_into, updated_at',
      researches: 'id, updated_at',
      decisions: 'id, track_id, research_id, [research_id+decision], updated_at',
      categories: 'id, name',
      track_categories: 'id, track_id, research_id, category_id, [track_id+research_id]',
      playlists: 'id, research_id, category_id',
      playlist_tracks: 'id, playlist_id, track_id, [playlist_id+position]',
      sync_events: 'op_id, &[origin+seq], hlc, entity_id, synchronization_status',
      conflicts: 'id, entity_type, entity_id',
      meta: 'key',
      users: 'id',
      devices: 'id, pairing_status',
    });
  }

  entityTable(type: EntityType): Table {
    return this.table(ENTITY_TABLES[type]);
  }

  /** Todas as tabelas que participam de uma escrita de domínio. */
  get writeTables(): Table[] {
    return [
      ...Object.values(ENTITY_TABLES).map((t) => this.table(t)),
      this.sync_events,
      this.conflicts,
      this.meta,
    ];
  }
}
