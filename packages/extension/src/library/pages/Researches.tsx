import { Archive, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { summarizeResearches } from '../../data/queries';
import { curation, mutate, useSnapshot } from '../api';
import { buttonClass, EmptyState, inputClass, PageHeader } from '../components';

export function ResearchesPage() {
  const snapshot = useSnapshot();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  if (!snapshot) return null;

  const summaries = summarizeResearches(snapshot).filter(
    (s) => showArchived || !s.research.archived,
  );
  const archivedCount = snapshot.researches.filter((r) => r.archived).length;

  return (
    <>
      <PageHeader
        title="Pesquisas"
        subtitle="Cada pesquisa guarda suas próprias decisões: uma faixa pode ser aprovada numa e rejeitada noutra."
      />

      <form
        data-testid="research-form"
        className="mb-6 grid gap-2 rounded-xl border border-neutral-200 p-4 sm:grid-cols-[1fr_2fr_auto] dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void mutate(() => curation.createResearch(name, description));
          setName('');
          setDescription('');
        }}
      >
        <input
          aria-label="Nome da pesquisa"
          placeholder="Nome (ex.: Latin Bass)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          aria-label="Descrição"
          placeholder="Descrição (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
        <button type="submit" className={buttonClass} disabled={!name.trim()}>
          <Plus size={15} aria-hidden /> Criar pesquisa
        </button>
      </form>

      {archivedCount > 0 && (
        <label className="mb-3 flex items-center gap-2 text-sm text-neutral-500">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Mostrar arquivadas ({archivedCount})
        </label>
      )}

      {summaries.length === 0 ? (
        <EmptyState>
          Nenhuma pesquisa ainda. Crie a primeira acima ou direto no widget do SoundCloud.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="research-list">
          {summaries.map(({ research, approved, rejected, pending }) => (
            <li key={research.id}>
              <Link
                to={`/researches/${research.id}`}
                className="block rounded-xl border border-neutral-200 p-4 transition hover:border-orange-400 hover:shadow-sm dark:border-neutral-800"
              >
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-semibold">{research.name}</h2>
                  {research.archived && (
                    <Archive size={14} className="text-neutral-400" aria-label="Arquivada" />
                  )}
                </div>
                {research.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                    {research.description}
                  </p>
                )}
                <dl className="mt-3 flex gap-4 text-sm">
                  <div>
                    <dt className="text-neutral-500">Aprovadas</dt>
                    <dd className="font-semibold text-emerald-600" data-testid="count-approved">
                      {approved}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Rejeitadas</dt>
                    <dd className="font-semibold text-red-500" data-testid="count-rejected">
                      {rejected}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Sem categoria</dt>
                    <dd className="font-semibold text-amber-600" data-testid="count-pending">
                      {pending}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
