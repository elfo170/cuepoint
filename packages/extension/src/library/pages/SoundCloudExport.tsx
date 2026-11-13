import type { Playlist } from '@cuepoint/core';
import { ExternalLink, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { PlaylistItem } from '../../data/playlists';
import { mutate, playlists } from '../api';
import { buttonClass, ConfirmButton, secondaryButtonClass } from '../components';
import {
  exportTracks,
  scRequest,
  SKIP_REASON,
  useSoundCloud,
  type DiffTrack,
  type ScDiff,
  type ScExportResult,
  type SkippedTrack,
} from '../soundcloud';
import { ArtistProBadge } from './SoundCloudSettings';

function TrackList({ title, tracks }: { title: string; tracks: DiffTrack[] }) {
  if (!tracks.length) return null;
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="ml-5 list-disc text-neutral-600 dark:text-neutral-400">
        {tracks.map((t) => (
          <li key={t.urn}>
            {t.title} <span className="text-neutral-500">— {t.artist}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Skipped({ tracks }: { tracks: SkippedTrack[] }) {
  if (!tracks.length) return null;
  return (
    <div className="text-amber-700">
      <p className="font-medium">Ficam de fora ({tracks.length}):</p>
      <ul className="ml-5 list-disc">
        {tracks.map((t, i) => (
          <li key={i}>
            {t.title} — {t.artist} ({SKIP_REASON[t.reason]})
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Exportar a playlist para o SoundCloud (Sprint 15). Toda chamada à API parte de um clique.
 * Guarda só o URN da playlist publicada (`external_playlist_id`, sincronizado).
 */
export function SoundCloudExport({
  playlist,
  items,
}: {
  playlist: Playlist;
  items: PlaylistItem[];
}) {
  const [view] = useSoundCloud();
  const [sharing, setSharing] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ScDiff | null>(null);
  const [result, setResult] = useState<ScExportResult | null>(null);
  const linked = playlist.external_playlist_id;

  const guard = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = (playlistUrn: string | null) =>
    guard('Enviando…', async () => {
      const r = await scRequest<ScExportResult>({
        type: 'sc:export',
        playlistUrn,
        title: playlist.name,
        description: playlist.description,
        sharing,
        tracks: exportTracks(items),
      });
      if (r.urn !== linked)
        await mutate(() => playlists.update(playlist.id, { external_playlist_id: r.urn }));
      setDiff(null);
      setResult(r);
    });

  const preview = guard('Comparando com o SoundCloud…', async () => {
    setResult(null);
    setDiff(
      await scRequest<ScDiff>({
        type: 'sc:diff',
        playlistUrn: linked,
        tracks: exportTracks(items),
      }),
    );
  });

  let body;
  if (view.kind === 'loading') return null;
  if (view.kind === 'no-helper' || view.status.state === 'unconfigured') {
    body = (
      <p>
        Para criar esta playlist na sua conta do SoundCloud,{' '}
        <Link to="/settings" className="text-orange-600 underline">
          configure a exportação
        </Link>{' '}
        (exige Artist Pro). Sem isso, use os botões de exportar links, CSV ou JSON.
      </p>
    );
  } else if (view.status.state !== 'connected') {
    body = (
      <p>
        {view.status.state === 'reconnect'
          ? 'O acesso ao SoundCloud caiu. '
          : 'Falta entrar com a sua conta. '}
        <Link to="/settings" className="text-orange-600 underline">
          Abrir Configurações
        </Link>
      </p>
    );
  } else if (!linked) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="sc-sharing"
            checked={sharing === 'private'}
            onChange={() => setSharing('private')}
          />{' '}
          Privada
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="sc-sharing"
            checked={sharing === 'public'}
            onChange={() => setSharing('public')}
          />{' '}
          Pública
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={!!busy || !items.length}
          onClick={send(null)}
          data-testid="sc-export"
        >
          <Upload size={14} aria-hidden /> Exportar para o SoundCloud
        </button>
      </div>
    );
  } else {
    const nothing = diff?.exists && !diff.add.length && !diff.remove.length && !diff.reordered;
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-neutral-500">
            Publicada no SoundCloud (<code className="text-xs">{linked}</code>)
          </span>
          <button
            type="button"
            className={`${buttonClass} ml-auto`}
            disabled={!!busy}
            onClick={preview}
          >
            <Upload size={14} aria-hidden /> Atualizar no SoundCloud
          </button>
          <ConfirmButton
            label="Desvincular"
            confirmLabel="Desvincular mesmo"
            onConfirm={() =>
              void mutate(() => playlists.update(playlist.id, { external_playlist_id: null })).then(
                () => {
                  setDiff(null);
                  setResult(null);
                },
              )
            }
          />
        </div>
        {diff && !diff.exists && (
          <div className="space-y-2">
            <p className="text-amber-700">
              Essa playlist não existe mais no SoundCloud (foi apagada ou é de outra conta).
            </p>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={!!busy}
              onClick={send(null)}
            >
              Criar outra
            </button>
          </div>
        )}
        {diff?.exists && (
          <div className="space-y-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900">
            <p>
              A playlist no SoundCloud ({diff.remoteCount} música(s)) vai ficar igual à do CuePoint
              ({items.length - diff.skipped.length} música(s)), na mesma ordem.
            </p>
            {nothing && <p className="text-neutral-500">Nada muda: as duas já estão iguais.</p>}
            <TrackList title={`Entram (${diff.add.length}):`} tracks={diff.add} />
            <TrackList title={`Saem do SoundCloud (${diff.remove.length}):`} tracks={diff.remove} />
            {diff.reordered && <p>A ordem das músicas muda.</p>}
            <Skipped tracks={diff.skipped} />
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={!!busy || !!nothing}
                onClick={send(linked)}
                data-testid="sc-confirm-update"
              >
                Confirmar atualização
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setDiff(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      data-testid="sc-export-card"
      className="mb-4 space-y-2 rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">SoundCloud</h2>
        <ArtistProBadge />
      </div>
      {body}
      {busy && <p className="text-neutral-500">{busy}</p>}
      {error && <p className="text-red-600">{error}</p>}
      {result && (
        <div className="space-y-1" role="status">
          <p className="text-emerald-700">
            {result.trackCount} música(s) no SoundCloud.{' '}
            {result.permalinkUrl && (
              <a
                href={result.permalinkUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                Abrir <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </p>
          {!result.verified && (
            <p className="text-amber-700">
              Atenção: a lista conferida no SoundCloud ficou diferente da enviada. Abra a playlist e
              confira.
            </p>
          )}
          <Skipped tracks={result.skipped} />
        </div>
      )}
    </section>
  );
}
