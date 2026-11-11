import { Check, Combine, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { categoryDuplicates, categoryUsage } from '../../data/queries';
import { curation, mutate, useSnapshot } from '../api';
import {
  buttonClass,
  ConfirmButton,
  EmptyState,
  inputClass,
  PageHeader,
  secondaryButtonClass,
} from '../components';

export function CategoriesPage() {
  const snapshot = useSnapshot();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(
    null,
  );
  if (!snapshot) return null;
  const usage = categoryUsage(snapshot);
  const duplicates = categoryDuplicates(snapshot.categories);
  const uses = (id: string) => usage.find((u) => u.category.id === id)?.uses ?? 0;

  return (
    <>
      <PageHeader
        title="Categorias"
        subtitle="Globais e reutilizáveis entre pesquisas. Uma música aprovada pode ter várias."
      />
      <form
        className="mb-6 flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void mutate(() => curation.createCategory(name));
          setName('');
        }}
      >
        <input
          aria-label="Nova categoria"
          placeholder="Nova categoria (ex.: Vocal)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <button type="submit" className={buttonClass} disabled={!name.trim()}>
          <Plus size={15} aria-hidden /> Criar
        </button>
      </form>

      {duplicates.length > 0 && (
        <section
          data-testid="category-duplicates"
          className="mb-6 max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30"
        >
          <p className="font-medium">Categorias com o mesmo nome</p>
          <p className="mt-1 mb-3 text-neutral-600 dark:text-neutral-400">
            Provavelmente criadas em aparelhos diferentes. Juntar move todas as classificações para
            a mais antiga e exclui as outras.
          </p>
          <ul className="space-y-2">
            {duplicates.map((group) => (
              <li key={group[0]!.id} className="flex flex-wrap items-center gap-3">
                <span>
                  <strong>{group[0]!.name}</strong>{' '}
                  <span className="text-neutral-500">
                    ({group.length} categorias, {group.reduce((n, c) => n + uses(c.id), 0)}{' '}
                    classificação(ões))
                  </span>
                </span>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() =>
                    void mutate(() =>
                      curation.mergeCategories(
                        group[0]!.id,
                        group.slice(1).map((c) => c.id),
                      ),
                    )
                  }
                >
                  <Combine size={15} aria-hidden /> Juntar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {usage.length === 0 ? (
        <EmptyState>Nenhuma categoria ainda.</EmptyState>
      ) : (
        <ul
          className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
          data-testid="category-list"
        >
          {usage.map(({ category, uses }) => (
            <li key={category.id} className="flex flex-wrap items-center gap-3 p-3">
              {editing?.id === category.id ? (
                <form
                  className="flex flex-1 flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!editing.name.trim()) return;
                    void mutate(() =>
                      curation.updateCategory(category.id, {
                        name: editing.name.trim(),
                        description: editing.description.trim(),
                      }),
                    );
                    setEditing(null);
                  }}
                >
                  <input
                    aria-label="Nome"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={`${inputClass} max-w-48`}
                  />
                  <input
                    aria-label="Descrição"
                    placeholder="Descrição"
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    className={`${inputClass} max-w-sm`}
                  />
                  <button
                    type="submit"
                    aria-label="Salvar"
                    className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50"
                  >
                    <Check size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancelar"
                    onClick={() => setEditing(null)}
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium" data-testid="category-name">
                      {category.name}
                    </span>
                    {category.description && (
                      <span className="ml-2 text-sm text-neutral-500">{category.description}</span>
                    )}
                  </div>
                  <span className="text-sm text-neutral-500">{uses} classificação(ões)</span>
                  <button
                    type="button"
                    aria-label={`Editar ${category.name}`}
                    onClick={() =>
                      setEditing({
                        id: category.id,
                        name: category.name,
                        description: category.description,
                      })
                    }
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <ConfirmButton
                    label="Excluir"
                    testId="delete-category"
                    onConfirm={() => void mutate(() => curation.deleteCategory(category.id))}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
