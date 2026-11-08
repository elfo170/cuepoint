import { Link2, Search } from 'lucide-react';
import { useState } from 'react';
import { normalizeTrackUrl, UrnResolver } from '../../content/soundcloud';
import { allTracks } from '../../data/queries';
import { curation, mutate, useSnapshot } from '../api';
import {
  buttonClass,
  CategoryChips,
  ConfirmButton,
  DecisionButtons,
  EmptyState,
  inputClass,
  PageHeader,
  TrackCell,
} from '../components';

const resolver = new UrnResolver();

function IdentifyForm({ trackId, onDone }: { trackId: string; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const normalized = normalizeTrackUrl(url);
        if (!normalized) {
          setError('Cole a URL de uma faixa do SoundCloud (soundcloud.com/artista/faixa).');
          return;
        }
        setBusy(true);
        setError(null);
        const urn = await resolver.resolve(normalized);
        if (!urn) {
          setBusy(false);
          setError('Não foi possível identificar a faixa por essa URL (verifique a conexão).');
          return;
        }
        const track = await curation.store.get('track', trackId);
        const definitive = await mutate(() =>
          curation.ensureTrack({
            title: track?.title ?? '',
            artist: track?.artist ?? '',
            url: normalized,
            urn,
            artworkUrl: track?.artwork_url ?? null,
            source: 'manual',
          }),
        );
        await mutate(() => curation.mergeTracks(trackId, definitive.id));
        setBusy(false);
        onDone();
      }}
    >
      <input
        aria-label="URL da faixa no SoundCloud"
        placeholder="https://soundcloud.com/artista/faixa"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className={`${inputClass} max-w-md`}
      />
      <button type="submit" className={buttonClass} disabled={busy}>
        Associar
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

/** Visão global: a música como entidade central, com a decisão em cada pesquisa (PRD §7.2). */
export function TracksPage() {
  const snapshot = useSnapshot();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string[]>([]);
  const [identifying, setIdentifying] = useState<string | null>(null);
  if (!snapshot) return null;

  const researches = snapshot.researches
    .filter((r) => !r.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const rows = allTracks(snapshot, search, filter);

  return (
    <>
      <PageHeader title="Músicas" subtitle={`${snapshot.tracks.length} música(s) na biblioteca`} />
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,18rem)_1fr]">
        <label className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            aria-label="Buscar"
            placeholder="Buscar por título ou artista"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-8`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-500">Categoria:</span>
          <CategoryChips
            categories={snapshot.categories}
            selected={filter}
            onToggle={(c) =>
              setFilter((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]))
            }
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          Nenhuma música. As faixas entram na biblioteca ao serem avaliadas no widget.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm" data-testid="tracks-table">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500 uppercase dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2 font-medium">Música</th>
                {researches.map((r) => (
                  <th key={r.id} className="px-3 py-2 font-medium whitespace-nowrap">
                    {r.name}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {rows.map(({ track, decisions }) => (
                <tr key={track.id} data-testid="track-row">
                  <td className="max-w-xs px-3 py-2">
                    <TrackCell track={track} />
                    {!track.soundcloud_urn &&
                      (identifying === track.id ? (
                        <IdentifyForm trackId={track.id} onDone={() => setIdentifying(null)} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIdentifying(track.id)}
                          className="mt-1 inline-flex items-center gap-1 text-xs text-orange-600 hover:underline"
                        >
                          <Link2 size={12} aria-hidden /> Identificar pela URL
                        </button>
                      ))}
                  </td>
                  {researches.map((r) => (
                    <td key={r.id} className="px-3 py-2">
                      <DecisionButtons
                        size="sm"
                        value={decisions[r.id] ?? null}
                        onChange={(value) =>
                          void mutate(() => curation.setDecision(track.id, r.id, value))
                        }
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <ConfirmButton
                      label="Excluir"
                      onConfirm={() => void mutate(() => curation.store.remove('track', track.id))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
