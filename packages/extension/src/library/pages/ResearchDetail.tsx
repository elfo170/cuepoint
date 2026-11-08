import { Archive, ArchiveRestore, ArrowLeft, Pencil, Search, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { researchTracks, type ResearchTab } from '../../data/queries';
import { curation, mutate, useSnapshot } from '../api';
import {
  buttonClass,
  CategoryChips,
  ConfirmButton,
  DecisionButtons,
  EmptyState,
  inputClass,
  PageHeader,
  secondaryButtonClass,
  TrackCell,
} from '../components';

const TABS: { id: ResearchTab; label: string }[] = [
  { id: 'approved', label: 'Aprovadas' },
  { id: 'rejected', label: 'Rejeitadas' },
  { id: 'pending', label: 'Pendentes de classificação' },
];

export function ResearchDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const snapshot = useSnapshot();
  const [tab, setTab] = useState<ResearchTab>('approved');
  const [filter, setFilter] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '' });
  const [openEditor, setOpenEditor] = useState<string | null>(null);

  if (!snapshot) return null;
  const research = snapshot.researches.find((r) => r.id === id);
  if (!research) {
    return (
      <EmptyState>
        Pesquisa não encontrada.{' '}
        <Link to="/" className="text-orange-600 underline">
          Voltar
        </Link>
      </EmptyState>
    );
  }
  const rows = researchTracks(snapshot, id, tab, tab === 'pending' ? [] : filter, search);
  const counts = Object.fromEntries(
    TABS.map((t) => [t.id, researchTracks(snapshot, id, t.id).length]),
  ) as Record<ResearchTab, number>;
  const categoryName = new Map(snapshot.categories.map((c) => [c.id, c.name]));

  return (
    <>
      <Link
        to="/"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-orange-600"
      >
        <ArrowLeft size={14} aria-hidden /> Pesquisas
      </Link>

      {editing ? (
        <form
          className="mb-6 grid gap-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            void mutate(() =>
              curation.updateResearch(id, {
                name: draft.name.trim(),
                description: draft.description.trim(),
              }),
            );
            setEditing(false);
          }}
        >
          <input
            aria-label="Nome da pesquisa"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={inputClass}
          />
          <textarea
            aria-label="Descrição"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className={inputClass}
            rows={2}
          />
          <div className="flex gap-2">
            <button type="submit" className={buttonClass}>
              Salvar
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <PageHeader
          title={research.name}
          subtitle={research.description || undefined}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => {
                  setDraft({ name: research.name, description: research.description });
                  setEditing(true);
                }}
              >
                <Pencil size={14} aria-hidden /> Editar
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() =>
                  void mutate(() => curation.updateResearch(id, { archived: !research.archived }))
                }
              >
                {research.archived ? (
                  <>
                    <ArchiveRestore size={14} aria-hidden /> Desarquivar
                  </>
                ) : (
                  <>
                    <Archive size={14} aria-hidden /> Arquivar
                  </>
                )}
              </button>
              <ConfirmButton
                label="Excluir"
                testId="delete-research"
                onConfirm={() => {
                  void mutate(() => curation.deleteResearch(id)).then(() => navigate('/'));
                }}
              />
            </div>
          }
        />
      )}

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.id
                ? 'border-orange-500 font-medium text-orange-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            {t.label} <span className="text-neutral-400">({counts[t.id]})</span>
          </button>
        ))}
      </div>

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
        {tab !== 'pending' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neutral-500">Filtrar por categoria:</span>
            <CategoryChips
              testId="category-filter"
              categories={snapshot.categories}
              selected={filter}
              onToggle={(c) =>
                setFilter((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]))
              }
            />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState>Nenhuma música nesta visão.</EmptyState>
      ) : (
        <ul
          className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
          data-testid="research-tracks"
        >
          {rows.map(({ track, decision, categoryIds }) => (
            <li key={track.id} className="p-3" data-testid="research-track-row">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <TrackCell track={track} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {categoryIds.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800"
                    >
                      {categoryName.get(c)}
                    </span>
                  ))}
                </div>
                {decision.decision && (
                  <button
                    type="button"
                    title="Classificar"
                    aria-label="Classificar"
                    onClick={() => setOpenEditor(openEditor === track.id ? null : track.id)}
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Tag size={15} aria-hidden />
                  </button>
                )}
                <DecisionButtons
                  size="sm"
                  value={decision.decision}
                  onChange={(value) => void mutate(() => curation.setDecision(track.id, id, value))}
                />
              </div>
              {openEditor === track.id && (
                <div className="mt-3 ml-13">
                  <CategoryChips
                    categories={snapshot.categories}
                    selected={categoryIds}
                    onToggle={(c) =>
                      void mutate(() =>
                        curation.setTrackCategory(track.id, id, c, !categoryIds.includes(c)),
                      )
                    }
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
