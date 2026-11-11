import {
  decisionId,
  newId,
  playlistTrackId,
  trackCategoryId,
  trackIdFromUrn,
  type Category,
  type Decision,
  type Research,
  type Track,
  type TrackCategory,
} from '@cuepoint/core';
import type { Store } from './store';

/** Dados mínimos para identificar uma faixa (vindos do widget, do Android ou manuais). */
export interface TrackInput {
  title: string;
  artist: string;
  url: string | null;
  urn: string | null;
  artworkUrl: string | null;
  source: string;
}

export interface TrackState {
  trackId: string | null;
  provisional: boolean;
  decision: boolean | null;
  categoryIds: string[];
}

const alive = <T extends { deleted_at: string | null }>(r: T | undefined): r is T =>
  !!r && r.deleted_at === null;

/** Operações de curadoria (PRD §6.2, §7, §9). */
export class Curation {
  constructor(readonly store: Store) {}

  private get db() {
    return this.store.db;
  }

  // ---------- Pesquisas ----------

  async listResearches(includeArchived = false): Promise<Research[]> {
    const all = await this.db.researches.toArray();
    return all
      .filter((r) => alive(r) && (includeArchived || !r.archived))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async createResearch(name: string, description = ''): Promise<Research> {
    await this.store.init();
    return this.store.put('research', newId(), {
      user_id: this.store.userId,
      name: name.trim(),
      description: description.trim(),
      archived: false,
    });
  }

  async updateResearch(
    id: string,
    changes: Partial<Pick<Research, 'name' | 'description' | 'archived'>>,
  ): Promise<void> {
    await this.store.put('research', id, changes);
  }

  async deleteResearch(id: string): Promise<void> {
    await this.store.remove('research', id);
    if ((await this.getActiveResearchId()) === id) await this.setActiveResearchId(null);
  }

  async getActiveResearchId(): Promise<string | null> {
    const id = (await this.store.getMeta<string | null>('activeResearchId')) ?? null;
    if (!id) return null;
    const r = await this.db.researches.get(id);
    return alive(r) && !r.archived ? id : null;
  }

  async setActiveResearchId(id: string | null): Promise<void> {
    await this.store.setMeta('activeResearchId', id);
  }

  // ---------- Categorias (globais, PRD §7.3) ----------

  async listCategories(): Promise<Category[]> {
    const all = await this.db.categories.toArray();
    return all.filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  /** Cria a categoria; se já existir uma com o mesmo nome (sem diferenciar maiúsculas), reutiliza. */
  async createCategory(name: string, description = ''): Promise<Category> {
    await this.store.init();
    const clean = name.trim();
    const existing = (await this.listCategories()).find(
      (c) => c.name.localeCompare(clean, 'pt-BR', { sensitivity: 'accent' }) === 0,
    );
    if (existing) return existing;
    return this.store.put('category', newId(), {
      user_id: this.store.userId,
      name: clean,
      description: description.trim(),
    });
  }

  async updateCategory(id: string, changes: Partial<Pick<Category, 'name' | 'description'>>) {
    await this.store.put('category', id, changes);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.store.write(async (tx) => {
      const links = await this.db.track_categories.where('category_id').equals(id).toArray();
      for (const link of links.filter(alive)) {
        await tx.put('track_category', link.id, { deleted_at: new Date().toISOString() }, 'delete');
      }
      await tx.put('category', id, { deleted_at: new Date().toISOString() }, 'delete');
    });
  }

  // ---------- Faixas (PRD §8) ----------

  /** Procura a faixa sem criar registro. */
  async findTrack(
    input: Pick<TrackInput, 'urn' | 'url' | 'title' | 'artist'>,
  ): Promise<Track | undefined> {
    if (input.urn) {
      const t = await this.db.tracks.get(trackIdFromUrn(input.urn));
      if (alive(t)) return t;
    }
    return this.findProvisional(input);
  }

  private async findProvisional(
    input: Pick<TrackInput, 'url' | 'title' | 'artist'>,
  ): Promise<Track | undefined> {
    const candidates = input.url
      ? await this.db.tracks.where('soundcloud_url').equals(input.url).toArray()
      : (await this.db.tracks.filter((t) => t.soundcloud_url === null).toArray()).filter(
          (t) => t.title === input.title && t.artist === input.artist,
        );
    return candidates.find((t) => alive(t) && !t.soundcloud_urn && !t.merged_into);
  }

  /**
   * Garante a faixa na biblioteca. Com URN: id determinístico (sem duplicar entre aparelhos).
   * Sem URN: faixa provisória (casada apenas por URL idêntica, ou título+artista idênticos sem URL).
   * Se havia uma provisória e agora o URN é conhecido, ela é associada à definitiva.
   */
  async ensureTrack(input: TrackInput): Promise<Track> {
    await this.store.init();
    if (input.urn) {
      const id = trackIdFromUrn(input.urn);
      const provisional = await this.findProvisional(input);
      const existing = await this.db.tracks.get(id);
      const track = alive(existing)
        ? await this.refreshMetadata(existing, input)
        : await this.store.put('track', id, {
            soundcloud_urn: input.urn,
            soundcloud_url: input.url,
            title: input.title,
            artist: input.artist,
            artwork_url: input.artworkUrl,
            metadata_source: input.source,
            merged_into: null,
          });
      if (provisional) await this.mergeTracks(provisional.id, track.id);
      return track;
    }
    const provisional = await this.findProvisional(input);
    if (provisional) return this.refreshMetadata(provisional, input);
    return this.store.put('track', newId(), {
      soundcloud_urn: null,
      soundcloud_url: input.url,
      title: input.title,
      artist: input.artist,
      artwork_url: input.artworkUrl,
      metadata_source: input.source,
      merged_into: null,
    });
  }

  private async refreshMetadata(track: Track, input: TrackInput): Promise<Track> {
    const changes: Partial<Track> = {};
    if (input.title && input.title !== track.title) changes.title = input.title;
    if (input.artist && input.artist !== track.artist) changes.artist = input.artist;
    if (input.artworkUrl && input.artworkUrl !== track.artwork_url)
      changes.artwork_url = input.artworkUrl;
    if (input.url && input.url !== track.soundcloud_url) changes.soundcloud_url = input.url;
    if (!Object.keys(changes).length) return track;
    return this.store.put('track', track.id, changes);
  }

  /**
   * Associa uma faixa provisória a uma definitiva (PRD §8.2): decisões, classificações e itens
   * de playlist passam para a definitiva; a provisória fica marcada com `merged_into`.
   * Se a definitiva já tem outra decisão na mesma pesquisa, a da provisória entra como escrita
   * concorrente: valores diferentes viram conflito (nada é descartado em silêncio).
   */
  async mergeTracks(fromId: string, intoId: string): Promise<void> {
    if (fromId === intoId) return;
    await this.store.write(async (tx) => {
      const now = new Date().toISOString();
      const decisions = (await this.db.decisions.where('track_id').equals(fromId).toArray()).filter(
        alive,
      );
      for (const d of decisions) {
        const targetId = decisionId(intoId, d.research_id);
        const target = await tx.get('decision', targetId);
        await tx.put(
          'decision',
          targetId,
          {
            user_id: d.user_id,
            track_id: intoId,
            research_id: d.research_id,
            decision: d.decision,
            device_source: d.device_source,
          },
          undefined,
          { concurrent: alive(target) },
        );
        await tx.put('decision', d.id, { deleted_at: now }, 'delete');
      }
      const links = (
        await this.db.track_categories.where('track_id').equals(fromId).toArray()
      ).filter(alive);
      for (const l of links) {
        await tx.put('track_category', trackCategoryId(intoId, l.research_id, l.category_id), {
          track_id: intoId,
          research_id: l.research_id,
          category_id: l.category_id,
        });
        await tx.put('track_category', l.id, { deleted_at: now }, 'delete');
      }
      const items = (
        await this.db.playlist_tracks.where('track_id').equals(fromId).toArray()
      ).filter(alive);
      for (const item of items) {
        const target = playlistTrackId(item.playlist_id, intoId);
        if (!alive(await tx.get('playlist_track', target))) {
          await tx.put('playlist_track', target, {
            playlist_id: item.playlist_id,
            track_id: intoId,
            position: item.position,
          });
        }
        await tx.put('playlist_track', item.id, { deleted_at: now }, 'delete');
      }
      await tx.put('track', fromId, { merged_into: intoId });
    });
  }

  /**
   * Associa faixas provisórias às definitivas que chegaram de outro aparelho (rodar depois de
   * receber operações). Casa pela mesma URL ou, sem URL, por título e artista idênticos — a mesma
   * regra da identificação local; casamentos ambíguos (duas definitivas) ficam de fora.
   * Retorna quantas provisórias foram associadas.
   */
  async reconcileProvisional(): Promise<number> {
    await this.store.init();
    const tracks = (await this.db.tracks.toArray()).filter(alive);
    const definitive = tracks.filter((t) => t.soundcloud_urn && !t.merged_into);
    const index = (key: (t: Track) => string | null) => {
      const map = new Map<string, Track | null>();
      for (const t of definitive) {
        const k = key(t);
        if (k !== null) map.set(k, map.has(k) ? null : t); // null = ambíguo
      }
      return map;
    };
    const byUrl = index((t) => t.soundcloud_url);
    const byName = index((t) => `${t.title}\u0000${t.artist}`);
    let merged = 0;
    for (const p of tracks.filter((t) => !t.soundcloud_urn && !t.merged_into)) {
      const target = p.soundcloud_url
        ? byUrl.get(p.soundcloud_url)
        : byName.get(`${p.title}\u0000${p.artist}`);
      if (!target) continue;
      await this.mergeTracks(p.id, target.id);
      merged += 1;
    }
    return merged;
  }

  /**
   * Junta categorias com o mesmo nome (criadas em aparelhos diferentes) na de destino:
   * classificações e playlists passam para ela, e as demais são excluídas.
   */
  async mergeCategories(intoId: string, fromIds: string[]): Promise<void> {
    const sources = fromIds.filter((id) => id !== intoId);
    if (!sources.length) return;
    await this.store.write(async (tx) => {
      const now = new Date().toISOString();
      for (const fromId of sources) {
        const links = (
          await this.db.track_categories.where('category_id').equals(fromId).toArray()
        ).filter(alive);
        for (const l of links) {
          const target = trackCategoryId(l.track_id, l.research_id, intoId);
          if (!alive(await tx.get('track_category', target))) {
            await tx.put('track_category', target, {
              track_id: l.track_id,
              research_id: l.research_id,
              category_id: intoId,
            });
          }
          await tx.put('track_category', l.id, { deleted_at: now }, 'delete');
        }
        const playlists = (
          await this.db.playlists.where('category_id').equals(fromId).toArray()
        ).filter(alive);
        for (const p of playlists) await tx.put('playlist', p.id, { category_id: intoId });
        await tx.put('category', fromId, { deleted_at: now }, 'delete');
      }
    });
  }

  // ---------- Decisões e classificações ----------

  async getTrackState(input: TrackInput, researchId: string | null): Promise<TrackState> {
    let track = await this.findTrack(input);
    // URN recém-conhecido para uma faixa provisória já registrada: associa agora.
    if (track && !track.soundcloud_urn && input.urn) track = await this.ensureTrack(input);
    if (!track) return { trackId: null, provisional: !input.urn, decision: null, categoryIds: [] };
    return {
      trackId: track.id,
      provisional: !track.soundcloud_urn,
      ...(researchId
        ? await this.decisionState(track.id, researchId)
        : { decision: null, categoryIds: [] }),
    };
  }

  async decisionState(trackId: string, researchId: string) {
    const d = await this.db.decisions.get(decisionId(trackId, researchId));
    const links = await this.db.track_categories
      .where('[track_id+research_id]')
      .equals([trackId, researchId])
      .toArray();
    return {
      decision: alive(d) ? d.decision : null,
      categoryIds: links.filter(alive).map((l) => l.category_id),
    };
  }

  /** Registra a decisão booleana da faixa na pesquisa (PRD §9.4, §9.5). */
  async decide(trackId: string, researchId: string, value: boolean): Promise<Decision> {
    await this.store.init();
    return this.store.put('decision', decisionId(trackId, researchId), {
      user_id: this.store.userId,
      track_id: trackId,
      research_id: researchId,
      decision: value,
      device_source: this.store.deviceId,
    });
  }

  /** Define a decisão; `null` volta para "não avaliada". */
  async setDecision(trackId: string, researchId: string, value: boolean | null): Promise<void> {
    if (value === null) await this.clearDecision(trackId, researchId);
    else await this.decide(trackId, researchId, value);
  }

  /** Volta a faixa para "não avaliada" na pesquisa. */
  async clearDecision(trackId: string, researchId: string): Promise<void> {
    const id = decisionId(trackId, researchId);
    if (alive(await this.db.decisions.get(id))) await this.store.remove('decision', id);
  }

  async setTrackCategory(
    trackId: string,
    researchId: string,
    categoryId: string,
    on: boolean,
  ): Promise<TrackCategory | undefined> {
    const id = trackCategoryId(trackId, researchId, categoryId);
    const current = await this.db.track_categories.get(id);
    if (on) {
      if (alive(current)) return current;
      return this.store.put('track_category', id, {
        track_id: trackId,
        research_id: researchId,
        category_id: categoryId,
      });
    }
    if (alive(current)) await this.store.remove('track_category', id);
    return undefined;
  }
}
