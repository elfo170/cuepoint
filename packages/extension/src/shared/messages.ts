import type { TrackInput, TrackState } from '../data/curation';

export interface Option {
  id: string;
  name: string;
}

export interface WidgetState {
  researches: Option[];
  activeResearchId: string | null;
  categories: Option[];
  track: TrackState;
}

/** Mensagens do content script / páginas para o service worker. */
export type Request =
  | { type: 'widget:getState'; track: TrackInput | null }
  | { type: 'widget:decide'; track: TrackInput; value: boolean }
  | { type: 'widget:setCategory'; track: TrackInput; categoryId: string; on: boolean }
  | { type: 'widget:createCategory'; track: TrackInput | null; name: string }
  | { type: 'widget:setActiveResearch'; researchId: string | null }
  | { type: 'widget:createResearch'; name: string }
  | { type: 'openLibrary'; hash?: string }
  | { type: 'notifyChanged' }
  | { type: 'backup:run'; reason: 'manual' | 'pre-restore' }
  | { type: 'backup:reschedule' }
  | { type: 'store:reset' }
  | { type: 'ping' };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Mensagem do service worker para as abas: os dados mudaram. */
export const CHANGED_MESSAGE = 'cuepoint:changed';

export async function send<T>(request: Request): Promise<T> {
  let res: Response<T> | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as Response<T> | undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/context invalidated/i.test(msg) || !chrome.runtime?.id) {
      throw new Error('O CuePoint foi atualizado. Recarregue a página para continuar.');
    }
    throw new Error(`Não foi possível falar com o CuePoint: ${msg}`);
  }
  if (!res) throw new Error('Sem resposta do CuePoint (service worker indisponível).');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
