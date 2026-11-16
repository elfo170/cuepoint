/**
 * Exportação via Soundiiz (Sprint 18, Issue #4): alternativa sem Artist Pro. A biblioteca chama a
 * API pública direto (`https://soundiiz.com/*` em `host_permissions`, exigido pelo CORS), sem o
 * serviço do PC. Um pedido por clique, sem novas tentativas: a API tem limite de requisições.
 * Contrato e PoC: docs/SOUNDIIZ_API.md.
 */
import {
  soundiizCheck,
  soundiizImportRequest,
  soundiizParseResponse,
  type Playlist,
  type SoundiizBlock,
  type SoundiizPlaylistInput,
  type SoundiizResult,
} from '@cuepoint/core';
import type { PlaylistItem } from '../data/playlists';

export const SOUNDIIZ_TIMEOUT_MS = 30_000;

export function soundiizInput(playlist: Playlist, items: PlaylistItem[]): SoundiizPlaylistInput {
  return {
    name: playlist.name,
    description: playlist.description,
    tracks: items.map(({ track }) => ({ title: track.title, artist: track.artist })),
  };
}

/** O que impede o envio desta playlist (vazia ou acima de 200 faixas). */
export const soundiizBlock = (items: PlaylistItem[]) => soundiizCheck(items.length);

/** Envia a playlist ao Soundiiz e devolve o link de importação (ou o erro). */
export async function soundiizExport(
  playlist: Playlist,
  items: PlaylistItem[],
  fetchFn: typeof fetch = fetch,
): Promise<SoundiizResult> {
  const req = soundiizImportRequest(soundiizInput(playlist, items));
  try {
    const res = await fetchFn(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.payload),
      signal: AbortSignal.timeout(SOUNDIIZ_TIMEOUT_MS),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* resposta sem JSON */
    }
    return soundiizParseResponse(res.status, body);
  } catch (e) {
    return { ok: false, code: 'network', status: 0, message: (e as Error).message ?? null };
  }
}

export function soundiizBlockText(block: SoundiizBlock): string {
  return block.code === 'empty'
    ? 'Playlist vazia: adicione músicas para exportar.'
    : `Máximo de ${block.max} músicas por envio (esta tem ${block.count}).`;
}

export function soundiizErrorText(r: Extract<SoundiizResult, { ok: false }>): string {
  switch (r.code) {
    case 'invalid':
      return 'O Soundiiz recusou a playlist.';
    case 'unavailable':
      return 'Soundiiz indisponível. Tente em alguns minutos.';
    case 'network':
      return 'Não foi possível falar com o Soundiiz. Confira a conexão e tente de novo.';
    default:
      return 'Erro no Soundiiz. Tente mais tarde.';
  }
}

/** Abre o link de importação numa aba nova. */
export async function openSoundiiz(url: string): Promise<void> {
  await chrome.tabs.create({ url });
}
