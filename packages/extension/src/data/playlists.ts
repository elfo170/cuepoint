import {
  keyBetween,
  newId,
  playlistTrackId,
  type Playlist,
  type PlaylistTrack,
  type Track,
} from '@cuepoint/core';
import { localUserId, ownedBy } from './queries';
import type { Store } from './store';

const alive = <T extends { deleted_at: string | null }>(r: T | undefined): r is T =>
  !!r && r.deleted_at === null;

export interface PlaylistItem {
  item: PlaylistTrack;
  track: Track;
}

/** Ordem estável: posição e, em empate (inserções concorrentes), o id do item. */
export function compareItems(a: PlaylistTrack, b: PlaylistTrack): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : a.id.localeCompare(b.id);
}

/** Playlists internas (PRD §10.1, §11.1): manuais ou geradas por pesquisa/categoria. */
export class Playlists {
  constructor(readonly store: Store) {}

  private get db() {
    return this.store.db;
  }

  async list(): Promise<Playlist[]> {
    // só leitura (pode rodar dentro de liveQuery): o usuário vem da identidade gravada
    const userId = await localUserId(this.db);
    return (await this.db.playlists.toArray())
      .filter(alive)
      .filter(ownedBy(userId))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async items(playlistId: string): Promise<PlaylistItem[]> {
    const items = (await this.db.playlist_tracks.where('playlist_id').equals(playlistId).toArray())
      .filter(alive)
      .sort(compareItems);
    const out: PlaylistItem[] = [];
    for (const item of items) {
      let track = await this.db.tracks.get(item.track_id);
      // Faixa provisória associada depois: segue para a definitiva
      while (track?.merged_into) track = await this.db.tracks.get(track.merged_into);
      if (alive(track)) out.push({ item, track });
    }
    return out;
  }

  /** Faixas que a origem (pesquisa e/ou categoria) da playlist seleciona, na ordem de decisão. */
  async sourceTrackIds(source: { researchId: string | null; categoryId: string | null }) {
    const { researchId, categoryId } = source;
    if (!researchId && !categoryId) return [];
    let ids: string[] = [];
    if (researchId) {
      const approved = (await this.db.decisions.where('research_id').equals(researchId).toArray())
        .filter((d) => alive(d) && d.decision)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      ids = approved.map((d) => d.track_id);
    }
    if (categoryId) {
      const links = (
        await this.db.track_categories.where('category_id').equals(categoryId).toArray()
      )
        .filter(alive)
        .filter((l) => !researchId || l.research_id === researchId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const withCategory = new Set(links.map((l) => l.track_id));
      ids = researchId ? ids.filter((id) => withCategory.has(id)) : [...withCategory];
    }
    const tracks = await this.db.tracks.bulkGet([...new Set(ids)]);
    return tracks.filter((t): t is Track => alive(t) && !t.merged_into).map((t) => t.id);
  }

  async create(params: {
    name: string;
    description?: string;
    researchId?: string | null;
    categoryId?: string | null;
  }): Promise<Playlist> {
    await this.store.init();
    const id = newId();
    const source = { researchId: params.researchId ?? null, categoryId: params.categoryId ?? null };
    const trackIds = await this.sourceTrackIds(source);
    return this.store.write(async (tx) => {
      const playlist = await tx.put('playlist', id, {
        user_id: this.store.userId,
        name: params.name.trim(),
        description: (params.description ?? '').trim(),
        research_id: source.researchId,
        category_id: source.categoryId,
        external_playlist_id: null,
      });
      let last: string | null = null;
      for (const trackId of trackIds) {
        last = keyBetween(last, null);
        await tx.put('playlist_track', playlistTrackId(id, trackId), {
          playlist_id: id,
          track_id: trackId,
          position: last,
        });
      }
      return playlist;
    });
  }

  /** `external_playlist_id`: URN da playlist exportada para o SoundCloud (sincroniza). */
  async update(
    id: string,
    changes: Partial<Pick<Playlist, 'name' | 'description' | 'external_playlist_id'>>,
  ) {
    await this.store.put('playlist', id, changes);
  }

  async remove(id: string): Promise<void> {
    const items = (await this.db.playlist_tracks.where('playlist_id').equals(id).toArray()).filter(
      alive,
    );
    await this.store.write(async (tx) => {
      const now = new Date().toISOString();
      for (const item of items)
        await tx.put('playlist_track', item.id, { deleted_at: now }, 'delete');
      await tx.put('playlist', id, { deleted_at: now }, 'delete');
    });
  }

  /** Adiciona ao fim (ou reativa o item, se a faixa já esteve na playlist). Retorna false se já está. */
  async addTrack(playlistId: string, trackId: string): Promise<boolean> {
    const id = playlistTrackId(playlistId, trackId);
    if (alive(await this.db.playlist_tracks.get(id))) return false;
    const items = await this.items(playlistId);
    const position = keyBetween(items.at(-1)?.item.position ?? null, null);
    await this.store.put('playlist_track', id, {
      playlist_id: playlistId,
      track_id: trackId,
      position,
    });
    return true;
  }

  async removeItem(itemId: string): Promise<void> {
    await this.store.remove('playlist_track', itemId);
  }

  /** Move o item para o índice `to` (0 = topo). */
  async move(playlistId: string, itemId: string, to: number): Promise<void> {
    const others = (await this.items(playlistId)).filter((i) => i.item.id !== itemId);
    const index = Math.max(0, Math.min(to, others.length));
    const before = others[index - 1]?.item.position ?? null;
    let after = others[index]?.item.position ?? null;
    if (before !== null && after !== null && before >= after) after = null; // empate concorrente
    await this.store.put('playlist_track', itemId, { position: keyBetween(before, after) });
  }

  /** Acrescenta ao fim as faixas da origem que ainda não estão na playlist. */
  async refreshFromSource(playlistId: string): Promise<number> {
    const playlist = await this.db.playlists.get(playlistId);
    if (!alive(playlist)) return 0;
    const ids = await this.sourceTrackIds({
      researchId: playlist.research_id,
      categoryId: playlist.category_id,
    });
    let added = 0;
    for (const trackId of ids) if (await this.addTrack(playlistId, trackId)) added += 1;
    return added;
  }
}

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export type ExportFormat = 'urls' | 'csv' | 'json';

/** Exporta a playlist (alternativa local enquanto a API do SoundCloud não for validada). */
export function exportPlaylist(
  playlist: Playlist,
  items: PlaylistItem[],
  format: ExportFormat,
): { filename: string; mime: string; content: string } {
  const base = playlist.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'playlist';
  if (format === 'urls') {
    return {
      filename: `${base}.txt`,
      mime: 'text/plain',
      content:
        items
          .map(({ track }) => track.soundcloud_url ?? `# ${track.artist} - ${track.title}`)
          .join('\n') + '\n',
    };
  }
  if (format === 'csv') {
    const header = 'posicao,titulo,artista,url,urn';
    const rows = items.map(({ track }, i) =>
      [
        String(i + 1),
        track.title,
        track.artist,
        track.soundcloud_url ?? '',
        track.soundcloud_urn ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    return {
      filename: `${base}.csv`,
      mime: 'text/csv',
      content: [header, ...rows].join('\n') + '\n',
    };
  }
  return {
    filename: `${base}.json`,
    mime: 'application/json',
    content: JSON.stringify(
      {
        name: playlist.name,
        description: playlist.description,
        tracks: items.map(({ track }) => ({
          title: track.title,
          artist: track.artist,
          url: track.soundcloud_url,
          urn: track.soundcloud_urn,
        })),
      },
      null,
      2,
    ),
  };
}
