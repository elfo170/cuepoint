import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowLeft, ArrowUp, Download, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { exportPlaylist, type ExportFormat } from '../../data/playlists';
import { db, mutate, playlists, useSnapshot } from '../api';
import {
  ConfirmButton,
  EmptyState,
  inputClass,
  PageHeader,
  secondaryButtonClass,
  TrackCell,
} from '../components';
import { downloadText } from '../download';

export function PlaylistDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const snapshot = useSnapshot();
  const data = useLiveQuery(
    async () => ({ playlist: await db.playlists.get(id), items: await playlists.items(id) }),
    [id],
  );
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  if (!data || !snapshot) return null;
  const { playlist, items } = data;
  if (!playlist || playlist.deleted_at) {
    return (
      <EmptyState>
        Playlist não encontrada.{' '}
        <Link to="/playlists" className="text-orange-600 underline">
          Voltar
        </Link>
      </EmptyState>
    );
  }
  const inPlaylist = new Set(items.map((i) => i.track.id));
  const q = query.trim().toLocaleLowerCase('pt-BR');
  const candidates = q
    ? snapshot.tracks
        .filter((t) => !inPlaylist.has(t.id))
        .filter((t) => `${t.title} ${t.artist}`.toLocaleLowerCase('pt-BR').includes(q))
        .slice(0, 8)
    : [];
  const hasSource = !!(playlist.research_id || playlist.category_id);
  const doExport = (format: ExportFormat) => {
    const file = exportPlaylist(playlist, items, format);
    downloadText(file.filename, file.content, file.mime);
  };

  return (
    <>
      <Link
        to="/playlists"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-orange-600"
      >
        <ArrowLeft size={14} aria-hidden /> Playlists
      </Link>
      <PageHeader
        title={playlist.name}
        subtitle={`${items.length} música(s)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasSource && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={async () => {
                  const added = await mutate(() => playlists.refreshFromSource(id));
                  setNotice(added ? `${added} música(s) adicionada(s).` : 'Nada novo na origem.');
                }}
              >
                <RefreshCw size={14} aria-hidden /> Atualizar da origem
              </button>
            )}
            {(['urls', 'csv', 'json'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={secondaryButtonClass}
                onClick={() => doExport(f)}
              >
                <Download size={14} aria-hidden /> {f === 'urls' ? 'URLs' : f.toUpperCase()}
              </button>
            ))}
            <ConfirmButton
              label="Excluir"
              testId="delete-playlist"
              onConfirm={() =>
                void mutate(() => playlists.remove(id)).then(() => navigate('/playlists'))
              }
            />
          </div>
        }
      />
      {notice && (
        <p role="status" className="mb-3 text-sm text-neutral-500">
          {notice}
        </p>
      )}

      <div className="relative mb-4 max-w-md">
        <input
          aria-label="Adicionar música"
          placeholder="Adicionar música: busque por título ou artista"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={inputClass}
        />
        {candidates.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {candidates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    void mutate(() => playlists.addTrack(id, t.id));
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <Plus size={14} aria-hidden /> {t.title}
                  <span className="text-neutral-500">— {t.artist}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState>Playlist vazia.</EmptyState>
      ) : (
        <ol
          className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
          data-testid="playlist-items"
        >
          {items.map(({ item, track }, index) => (
            <li key={item.id} className="flex items-center gap-3 p-3" data-testid="playlist-item">
              <span className="w-6 text-right text-sm text-neutral-400">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <TrackCell track={track} />
              </div>
              <button
                type="button"
                aria-label="Subir"
                disabled={index === 0}
                onClick={() => void mutate(() => playlists.move(id, item.id, index - 1))}
                className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                <ArrowUp size={15} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Descer"
                disabled={index === items.length - 1}
                onClick={() => void mutate(() => playlists.move(id, item.id, index + 1))}
                className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                <ArrowDown size={15} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Remover da playlist"
                onClick={() => void mutate(() => playlists.removeItem(item.id))}
                className="rounded p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <X size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
