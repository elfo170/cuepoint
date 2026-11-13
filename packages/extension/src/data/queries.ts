import type { Category, Decision, Research, Track, TrackCategory } from '@cuepoint/core';
import type { CuePointDB } from './db';

const alive = <T extends { deleted_at: string | null }>(r: T | undefined): r is T =>
  !!r && r.deleted_at === null;

export type ResearchTab = 'approved' | 'rejected' | 'pending';

export interface ResearchSummary {
  research: Research;
  approved: number;
  rejected: number;
  /** Aprovadas ainda sem categoria (PRD §6.2: "pendente de classificação"). */
  pending: number;
}

export interface ResearchTrackRow {
  track: Track;
  decision: Decision;
  categoryIds: string[];
}

export interface TrackRow {
  track: Track;
  /** research_id → decisão */
  decisions: Record<string, boolean>;
}

export interface Snapshot {
  tracks: Track[];
  researches: Research[];
  decisions: Decision[];
  categories: Category[];
  trackCategories: TrackCategory[];
}

/**
 * Isolamento por usuário (PRD §16): só registros do usuário local. Faixas e vínculos não têm
 * `user_id` (a faixa é a mesma para todos, `uuidv5(urn)`) e seguem o registro pai.
 */
export const ownedBy =
  (userId: string | undefined) =>
  <T extends { user_id: string }>(r: T): boolean =>
    !userId || r.user_id === userId;

/** Usuário local gravado na identidade (ausente antes da primeira execução). */
export async function localUserId(db: CuePointDB): Promise<string | undefined> {
  return ((await db.meta.get('identity'))?.value as { userId?: string } | undefined)?.userId;
}

/** Lê os dados vivos (sem tombstones) do usuário local, usados pela biblioteca. */
export async function loadSnapshot(db: CuePointDB): Promise<Snapshot> {
  const [userId, tracks, researches, decisions, categories, trackCategories] = await Promise.all([
    localUserId(db),
    db.tracks.toArray(),
    db.researches.toArray(),
    db.decisions.toArray(),
    db.categories.toArray(),
    db.track_categories.toArray(),
  ]);
  return {
    tracks: tracks.filter((t) => alive(t) && !t.merged_into),
    researches: researches.filter(alive).filter(ownedBy(userId)),
    decisions: decisions.filter(alive).filter(ownedBy(userId)),
    categories: categories.filter(alive).filter(ownedBy(userId)),
    trackCategories: trackCategories.filter(alive),
  };
}

function categoriesByTrack(s: Snapshot, researchId: string): Map<string, string[]> {
  const live = new Set(s.categories.map((c) => c.id));
  const map = new Map<string, string[]>();
  for (const tc of s.trackCategories) {
    if (tc.research_id !== researchId || !live.has(tc.category_id)) continue;
    map.set(tc.track_id, [...(map.get(tc.track_id) ?? []), tc.category_id]);
  }
  return map;
}

export function summarizeResearches(s: Snapshot): ResearchSummary[] {
  return s.researches
    .map((research) => {
      const cats = categoriesByTrack(s, research.id);
      const trackIds = new Set(s.tracks.map((t) => t.id));
      const decisions = s.decisions.filter(
        (d) => d.research_id === research.id && trackIds.has(d.track_id),
      );
      const approved = decisions.filter((d) => d.decision);
      return {
        research,
        approved: approved.length,
        rejected: decisions.length - approved.length,
        pending: approved.filter((d) => !cats.get(d.track_id)?.length).length,
      };
    })
    .sort((a, b) => a.research.name.localeCompare(b.research.name, 'pt-BR'));
}

function matchesSearch(track: Track, search: string): boolean {
  const q = search.trim().toLocaleLowerCase('pt-BR');
  if (!q) return true;
  return `${track.title} ${track.artist}`.toLocaleLowerCase('pt-BR').includes(q);
}

/** Músicas de uma pesquisa por aba, filtradas por categoria (todas as selecionadas) e busca. */
export function researchTracks(
  s: Snapshot,
  researchId: string,
  tab: ResearchTab,
  categoryFilter: string[] = [],
  search = '',
): ResearchTrackRow[] {
  const cats = categoriesByTrack(s, researchId);
  const byId = new Map(s.tracks.map((t) => [t.id, t]));
  const rows: ResearchTrackRow[] = [];
  for (const decision of s.decisions) {
    if (decision.research_id !== researchId) continue;
    const track = byId.get(decision.track_id);
    if (!track) continue;
    const categoryIds = cats.get(track.id) ?? [];
    if (tab === 'approved' && !decision.decision) continue;
    if (tab === 'rejected' && decision.decision) continue;
    if (tab === 'pending' && (!decision.decision || categoryIds.length > 0)) continue;
    if (!categoryFilter.every((c) => categoryIds.includes(c))) continue;
    if (!matchesSearch(track, search)) continue;
    rows.push({ track, decision, categoryIds });
  }
  return rows.sort((a, b) => b.decision.updated_at.localeCompare(a.decision.updated_at));
}

/** Visão global: cada música com sua decisão em cada pesquisa (PRD §7.2). */
export function allTracks(s: Snapshot, search = '', categoryFilter: string[] = []): TrackRow[] {
  const decisions = new Map<string, Record<string, boolean>>();
  for (const d of s.decisions) {
    decisions.set(d.track_id, {
      ...(decisions.get(d.track_id) ?? {}),
      [d.research_id]: d.decision,
    });
  }
  const catsByTrack = new Map<string, Set<string>>();
  for (const tc of s.trackCategories) {
    catsByTrack.set(tc.track_id, (catsByTrack.get(tc.track_id) ?? new Set()).add(tc.category_id));
  }
  return s.tracks
    .filter((t) => matchesSearch(t, search))
    .filter((t) => categoryFilter.every((c) => catsByTrack.get(t.id)?.has(c)))
    .map((track) => ({ track, decisions: decisions.get(track.id) ?? {} }))
    .sort((a, b) => b.track.updated_at.localeCompare(a.track.updated_at));
}

export interface CategoryUsage {
  category: Category;
  uses: number;
}

export function categoryUsage(s: Snapshot): CategoryUsage[] {
  return s.categories
    .map((category) => ({
      category,
      uses: s.trackCategories.filter((tc) => tc.category_id === category.id).length,
    }))
    .sort((a, b) => a.category.name.localeCompare(b.category.name, 'pt-BR'));
}

/**
 * Categorias vivas com o mesmo nome (sem espaços nas pontas, sem diferenciar maiúsculas) —
 * típico de categorias criadas em aparelhos diferentes. Em cada grupo, a primeira é o destino da
 * junção: a mais antiga (desempate pelo id), para que todos os aparelhos escolham a mesma.
 * Mesma regra no Android (`Queries.categoryDuplicates`).
 */
export function categoryDuplicates(categories: Category[]): Category[][] {
  const groups = new Map<string, Category[]>();
  for (const c of categories) {
    const key = c.name.trim().toLocaleLowerCase('pt-BR');
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const older = (a: Category, b: Category) =>
    a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : 1;
  return [...groups.values()].filter((g) => g.length > 1).map((g) => [...g].sort(older));
}
