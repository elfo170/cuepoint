import {
  canonicalJson,
  hlcToIso,
  valuesEquivalent,
  type Candidate,
  type EntityRecord,
  type EntityType,
  type JsonValue,
} from '@cuepoint/core';
import type { CuePointDB } from './db';

/** Um dos valores possíveis de um campo em conflito. */
export interface ConflictOption {
  value: JsonValue;
  /** Texto legível do valor (ex.: "Aprovada", "Excluída"). */
  label: string;
  /** Aparelhos que gravaram este valor (device_id). */
  origins: string[];
  /** Momento da gravação mais recente deste valor (ISO). */
  at: string;
  /** É o valor exibido hoje (vencedor provisório: o mais recente). */
  current: boolean;
}

/** Conflito pronto para a tela: o que é, qual campo e as opções lado a lado. */
export interface ConflictView {
  id: string;
  entityType: EntityType;
  entityId: string;
  field: string;
  /** Tipo do registro (ex.: "Pesquisa", "Decisão"). */
  kind: string;
  /** Qual registro (ex.: nome da pesquisa, "Faixa · Pesquisa"). */
  subject: string;
  /** Campo em conflito (ex.: "Nome", "Exclusão"). */
  fieldLabel: string;
  options: ConflictOption[];
  createdAt: string;
}

const KIND: Record<EntityType, string> = {
  track: 'Faixa',
  research: 'Pesquisa',
  decision: 'Decisão',
  category: 'Categoria',
  track_category: 'Classificação',
  playlist: 'Playlist',
  playlist_track: 'Item de playlist',
};

const FIELD: Record<string, string> = {
  name: 'Nome',
  description: 'Descrição',
  archived: 'Arquivada',
  decision: 'Decisão',
  deleted_at: 'Exclusão',
  merged_into: 'Associação a outra faixa',
  soundcloud_urn: 'Identificador do SoundCloud',
  research_id: 'Pesquisa',
  category_id: 'Categoria',
  track_id: 'Faixa',
  playlist_id: 'Playlist',
  position: 'Posição na playlist',
  external_playlist_id: 'Playlist no SoundCloud',
  user_id: 'Usuário',
};

type Lookup = (
  type: EntityType,
  id: string | null | undefined,
) => Promise<EntityRecord | undefined>;

async function describe(
  rec: EntityRecord | undefined,
  type: EntityType,
  get: Lookup,
): Promise<string> {
  const r = rec as unknown as Record<string, string | null> | undefined;
  if (!r) return '(registro desconhecido)';
  const title = async (trackId: string | null) => {
    const t = (await get('track', trackId)) as unknown as Record<string, string> | undefined;
    return t ? `${t.title}${t.artist ? ` — ${t.artist}` : ''}` : 'faixa desconhecida';
  };
  const name = async (t: EntityType, id: string | null) =>
    ((await get(t, id)) as unknown as { name?: string } | undefined)?.name ?? 'desconhecida';
  switch (type) {
    case 'track':
      return `${r.title}${r.artist ? ` — ${r.artist}` : ''}`;
    case 'research':
    case 'category':
    case 'playlist':
      return r.name ?? '';
    case 'decision':
      return `${await title(r.track_id ?? null)} · pesquisa ${await name('research', r.research_id ?? null)}`;
    case 'track_category':
      return `${await name('category', r.category_id ?? null)} em ${await title(r.track_id ?? null)} · pesquisa ${await name('research', r.research_id ?? null)}`;
    case 'playlist_track':
      return `${await title(r.track_id ?? null)} na playlist ${await name('playlist', r.playlist_id ?? null)}`;
  }
}

async function valueLabel(
  type: EntityType,
  field: string,
  value: JsonValue,
  get: Lookup,
): Promise<string> {
  if (field === 'deleted_at') return value === null ? 'Mantida (não excluída)' : 'Excluída';
  if (type === 'decision' && field === 'decision') return value ? 'Aprovada' : 'Rejeitada';
  if (field === 'merged_into') {
    if (value === null) return 'Não associada';
    const t = (await get('track', String(value))) as unknown as Record<string, string> | undefined;
    return `Associada a ${t ? t.title : 'outra faixa'}`;
  }
  const refs: Record<string, EntityType> = {
    research_id: 'research',
    category_id: 'category',
    playlist_id: 'playlist',
  };
  if (refs[field]) {
    if (value === null) return 'Nenhuma';
    const r = (await get(refs[field]!, String(value))) as unknown as { name?: string } | undefined;
    return r?.name ?? 'Desconhecida';
  }
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (value === null) return '(vazio)';
  if (typeof value === 'string') return value.trim() ? value : '(vazio)';
  return canonicalJson(value);
}

/** Agrupa candidatos de mesmo valor; o último (maior HLC) é o vencedor provisório. */
function groupCandidates(field: string, candidates: Candidate[]) {
  const sorted = [...candidates].sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
  const winner = sorted[sorted.length - 1];
  const groups: { value: JsonValue; origins: Set<string>; hlc: string; current: boolean }[] = [];
  for (const c of sorted) {
    const g = groups.find((x) => valuesEquivalent(field, x.value, c.value));
    if (g) {
      g.origins.add(c.origin);
      g.hlc = c.hlc;
      g.value = c.value;
      g.current ||= c === winner;
    } else {
      groups.push({
        value: c.value,
        origins: new Set([c.origin]),
        hlc: c.hlc,
        current: c === winner,
      });
    }
  }
  // Valor exibido hoje primeiro; depois do mais recente ao mais antigo.
  return groups.sort((a, b) =>
    a.current !== b.current ? (a.current ? -1 : 1) : a.hlc < b.hlc ? 1 : -1,
  );
}

/** Conflitos abertos, prontos para exibir lado a lado (mais recentes primeiro). */
export async function loadConflicts(db: CuePointDB): Promise<ConflictView[]> {
  const rows = await db.conflicts.toArray();
  const cache = new Map<string, EntityRecord | undefined>();
  const get: Lookup = async (type, id) => {
    if (!id) return undefined;
    const key = `${type}:${id}`;
    if (!cache.has(key))
      cache.set(key, (await db.entityTable(type).get(id)) as EntityRecord | undefined);
    return cache.get(key);
  };
  const out: ConflictView[] = [];
  for (const row of rows) {
    const type = row.entity_type as EntityType;
    const rec = await get(type, row.entity_id);
    const candidates = rec?._c?.[row.field];
    if (!rec || !candidates || candidates.length < 2) continue;
    const options: ConflictOption[] = [];
    for (const g of groupCandidates(row.field, candidates)) {
      options.push({
        value: g.value,
        label: await valueLabel(type, row.field, g.value, get),
        origins: [...g.origins],
        at: hlcToIso(g.hlc),
        current: g.current,
      });
    }
    if (options.length < 2) continue;
    out.push({
      id: row.id,
      entityType: type,
      entityId: row.entity_id,
      field: row.field,
      kind: KIND[type] ?? type,
      subject: await describe(rec, type, get),
      fieldLabel: FIELD[row.field] ?? row.field,
      options,
      createdAt: row.created_at,
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
