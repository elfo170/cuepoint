import { useCallback, useEffect, useState } from 'react';
import type { PlaylistItem } from '../data/playlists';
import { CHANGED_MESSAGE, send } from '../shared/messages';

/** Espelho dos tipos do serviço do PC (packages/helper/src/soundcloud/client.ts). */
export type ScState = 'unconfigured' | 'configured' | 'connected' | 'reconnect';

/** Aparelho pareado que pode receber as credenciais do app (bloco "Usar no celular"). */
export interface ScShareDevice {
  peerId: string;
  name: string;
  /** Liberação ativa até (epoch ms), ou null. */
  expiresAt: number | null;
  /** Quando o aparelho buscou as credenciais pela última vez (ISO). */
  sharedAt: string | null;
}

export interface ScStatus {
  state: ScState;
  clientId: string | null;
  user: { username: string; permalinkUrl: string | null } | null;
  loginPending: boolean;
  lastError: string | null;
  redirectUri: string;
  devices: ScShareDevice[];
}

export interface ExportTrack {
  urn: string | null;
  url: string | null;
  title: string;
  artist: string;
}

export interface SkippedTrack {
  title: string;
  artist: string;
  reason: 'sem_link' | 'nao_encontrada';
}

export interface DiffTrack {
  urn: string;
  title: string;
  artist: string;
}

export interface ScDiff {
  exists: boolean;
  add: DiffTrack[];
  remove: DiffTrack[];
  reordered: boolean;
  remoteCount: number;
  skipped: SkippedTrack[];
}

export interface ScExportResult {
  urn: string;
  permalinkUrl: string | null;
  trackCount: number;
  skipped: SkippedTrack[];
  verified: boolean;
}

/** O que preencher em soundcloud.com/you/apps (o nome não pode levar a marca SoundCloud). */
export const APP_FORM = {
  name: 'CuePoint',
  description: 'Uso pessoal: exporta as minhas playlists de curadoria do CuePoint.',
  website: 'https://github.com/elfo170/cuepoint/blob/main/docs/PRIVACIDADE.md',
} as const;

export const SC_APPS_URL = 'https://soundcloud.com/you/apps';

/** Pedido ao serviço do PC (repassado pelo service worker). */
export function scRequest<T>(req: { type: `sc:${string}` } & Record<string, unknown>): Promise<T> {
  return send<T>({ type: 'helper:request', req });
}

export type ScView =
  { kind: 'loading' } | { kind: 'no-helper'; reason: string } | { kind: 'ready'; status: ScStatus };

/** Estado da integração, atualizado quando o serviço avisa (login, desconexão, erro). */
export function useSoundCloud(): [ScView, () => Promise<void>] {
  const [view, setView] = useState<ScView>({ kind: 'loading' });
  const load = useCallback(async () => {
    try {
      const helper = await send<{ state: string; error: string | null }>({ type: 'helper:status' });
      if (helper.state !== 'connected') {
        setView({
          kind: 'no-helper',
          reason:
            helper.state === 'absent'
              ? 'O serviço do PC não está instalado.'
              : (helper.error ?? 'O serviço do PC não respondeu.'),
        });
        return;
      }
      setView({ kind: 'ready', status: await scRequest<ScStatus>({ type: 'sc:status' }) });
    } catch (e) {
      setView({ kind: 'no-helper', reason: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void load();
    const onMsg = (m: { type?: string }) => m?.type === CHANGED_MESSAGE && void load();
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [load]);
  return [view, load];
}

/** Faixas da playlist na ordem do CuePoint, no formato que o serviço exporta. */
export function exportTracks(items: PlaylistItem[]): ExportTrack[] {
  return items.map(({ track }) => ({
    urn: track.soundcloud_urn,
    url: track.soundcloud_url,
    title: track.title,
    artist: track.artist,
  }));
}

export const SKIP_REASON: Record<SkippedTrack['reason'], string> = {
  sem_link: 'sem link do SoundCloud',
  nao_encontrada: 'não encontrada no SoundCloud',
};
