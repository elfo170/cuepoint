/**
 * Exportação via Soundiiz (Issue #4): a API pública de importação recebe a lista de faixas e
 * devolve um link temporário em que o usuário revisa as correspondências e transfere a playlist
 * para o SoundCloud, sem Artist Pro. Só funções puras: quem faz a chamada é cada plataforma
 * (extensão e app Android, `SoundiizProtocol`). A paridade é conferida por
 * `spec/vectors/soundiiz.json`. Contrato e resultados da PoC: docs/SOUNDIIZ_API.md.
 */

export const SOUNDIIZ_IMPORT_URL = 'https://soundiiz.com/go/import-playlist';
/** Limite documentado de faixas por pedido (mínimo 1). */
export const SOUNDIIZ_MAX_TRACKS = 200;
/** Corename do SoundCloud na API do Soundiiz (preseleciona o destino). */
export const SOUNDIIZ_DESTINATION = 'soundcloud';
export const SOUNDIIZ_SOURCE_NAME = 'CuePoint';
export const SOUNDIIZ_DEFAULT_DESCRIPTION = 'Playlist exportada do CuePoint';
/** Só links do próprio Soundiiz são abertos (nunca um endereço qualquer vindo da resposta). */
export const SOUNDIIZ_SHARE_PREFIX = 'https://soundiiz.com/';

export interface SoundiizTrackInput {
  title: string;
  artist: string;
}

export interface SoundiizPlaylistInput {
  name: string;
  description: string | null;
  /** Na ordem da playlist. */
  tracks: SoundiizTrackInput[];
}

export interface SoundiizTrack {
  title: string;
  artists?: string[];
}

export interface SoundiizPayload {
  title: string;
  sourceName: string;
  description: string;
  destination: string;
  tracklist: SoundiizTrack[];
}

export interface SoundiizRequest {
  url: string;
  headers: Record<string, string>;
  /** Objeto a serializar como JSON (cada plataforma serializa). */
  payload: SoundiizPayload;
}

/** O que impede o envio antes de chamar a API. */
export type SoundiizBlock = { code: 'empty' } | { code: 'too_many'; count: number; max: number };

export function soundiizCheck(trackCount: number): SoundiizBlock | null {
  if (trackCount < 1) return { code: 'empty' };
  if (trackCount > SOUNDIIZ_MAX_TRACKS)
    return { code: 'too_many', count: trackCount, max: SOUNDIIZ_MAX_TRACKS };
  return null;
}

/** Texto aparado; se só houver espaços, mantém o original (a API exige título não vazio). */
const clean = (s: string) => s.trim() || s;

/**
 * Pedido de importação. Cada faixa leva título e artista, sem `album`/`isrc` (o CuePoint não os
 * tem e a API pede para não chutar) e sem URN ou link (a API não aceita IDs do SoundCloud).
 * Artista vazio é omitido. A ordem da playlist é preservada.
 */
export function soundiizImportRequest(p: SoundiizPlaylistInput): SoundiizRequest {
  return {
    url: SOUNDIIZ_IMPORT_URL,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    payload: {
      title: clean(p.name),
      sourceName: SOUNDIIZ_SOURCE_NAME,
      description: p.description?.trim() || SOUNDIIZ_DEFAULT_DESCRIPTION,
      destination: SOUNDIIZ_DESTINATION,
      tracklist: p.tracks.map((t) => {
        const artist = t.artist.trim();
        return artist ? { title: clean(t.title), artists: [artist] } : { title: clean(t.title) };
      }),
    },
  };
}

export type SoundiizErrorCode =
  /** HTTP 400: o Soundiiz recusou o pedido (mensagem dele em `message`). */
  | 'invalid'
  /** 429 ou 5xx: indisponível no momento. */
  | 'unavailable'
  /** Qualquer outra resposta inesperada (inclui link que não é do Soundiiz). */
  | 'http'
  /** Sem resposta (rede, timeout). Produzido pelas plataformas, não por `soundiizParseResponse`. */
  | 'network';

export type SoundiizResult =
  | { ok: true; shareUrl: string; nbTracks: number; expiresAt: number }
  | { ok: false; code: SoundiizErrorCode; status: number; message: string | null };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Interpreta a resposta da API (`body` já convertido de JSON, ou `null` se não era JSON). */
export function soundiizParseResponse(status: number, body: unknown): SoundiizResult {
  const obj = isObject(body) ? body : {};
  const message = typeof obj.message === 'string' && obj.message ? obj.message : null;
  if (status >= 200 && status < 300 && obj.status === 'success') {
    const { shareUrl, nbTracks, expiresAt } = obj;
    if (
      typeof shareUrl === 'string' &&
      shareUrl.startsWith(SOUNDIIZ_SHARE_PREFIX) &&
      typeof nbTracks === 'number' &&
      typeof expiresAt === 'number'
    )
      return { ok: true, shareUrl, nbTracks, expiresAt };
    return { ok: false, code: 'http', status, message: null };
  }
  if (status === 400) return { ok: false, code: 'invalid', status, message };
  if (status === 429 || status >= 500) return { ok: false, code: 'unavailable', status, message };
  return { ok: false, code: 'http', status, message };
}
