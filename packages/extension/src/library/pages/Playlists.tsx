import { ListMusic, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { mutate, playlists, useSnapshot } from '../api';
import { buttonClass, EmptyState, inputClass, PageHeader } from '../components';

export function PlaylistsPage() {
  const snapshot = useSnapshot();
  const list = useLiveQuery(async () => {
    const all = await playlists.list();
    const counts = await Promise.all(all.map((p) => playlists.items(p.id).then((i) => i.length)));
    return all.map((p, i) => ({ playlist: p, count: counts[i]! }));
  }, []);
  const [name, setName] = useState('');
  const [researchId, setResearchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  if (!snapshot || !list) return null;

  const researchName = new Map(snapshot.researches.map((r) => [r.id, r.name]));
  const categoryName = new Map(snapshot.categories.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Playlists"
        subtitle="Playlists internas do CuePoint, montadas à mão ou a partir de uma pesquisa e/ou categoria."
      />
      <form
        data-testid="playlist-form"
        className="mb-6 grid gap-2 rounded-xl border border-neutral-200 p-4 md:grid-cols-[1fr_1fr_1fr_auto] dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void mutate(() =>
            playlists.create({
              name,
              researchId: researchId || null,
              categoryId: categoryId || null,
            }),
          );
          setName('');
          setResearchId('');
          setCategoryId('');
        }}
      >
        <input
          aria-label="Nome da playlist"
          placeholder="Nome da playlist"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <select
          aria-label="Origem: pesquisa"
          value={researchId}
          onChange={(e) => setResearchId(e.target.value)}
          className={inputClass}
        >
          <option value="">Sem pesquisa (manual)</option>
          {snapshot.researches.map((r) => (
            <option key={r.id} value={r.id}>
              Aprovadas em {r.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Origem: categoria"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">Qualquer categoria</option>
          {snapshot.categories.map((c) => (
            <option key={c.id} value={c.id}>
              Categoria {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass} disabled={!name.trim()}>
          <Plus size={15} aria-hidden /> Criar playlist
        </button>
      </form>

      {list.length === 0 ? (
        <EmptyState>Nenhuma playlist ainda.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="playlist-list">
          {list.map(({ playlist, count }) => (
            <li key={playlist.id}>
              <Link
                to={`/playlists/${playlist.id}`}
                className="block rounded-xl border border-neutral-200 p-4 hover:border-orange-400 dark:border-neutral-800"
              >
                <div className="flex items-center gap-2">
                  <ListMusic size={16} className="text-orange-500" aria-hidden />
                  <h2 className="truncate font-semibold">{playlist.name}</h2>
                </div>
                <p className="mt-1 text-sm text-neutral-500">
                  {count} música(s)
                  {playlist.research_id && ` · ${researchName.get(playlist.research_id) ?? '?'}`}
                  {playlist.category_id && ` · ${categoryName.get(playlist.category_id) ?? '?'}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
