import { FolderSearch, Music2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send, type WidgetState } from '../shared/messages';
import '../styles.css';

function Popup() {
  const [state, setState] = useState<WidgetState | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    send<WidgetState>({ type: 'widget:getState', track: null })
      .then(setState)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="w-72 space-y-3 p-4 font-sans text-sm text-neutral-900">
      <header className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white">
          <Music2 size={14} aria-hidden />
        </span>
        <h1 className="text-base font-semibold">CuePoint</h1>
      </header>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-500">Pesquisa ativa</span>
        <select
          data-testid="popup-research"
          value={state?.activeResearchId ?? ''}
          onChange={async (e) => {
            await send({ type: 'widget:setActiveResearch', researchId: e.target.value || null });
            await load();
          }}
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
        >
          <option value="">Nenhuma</option>
          {state?.researches.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <form
        className="flex gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try {
            await send({ type: 'widget:createResearch', name });
            setName('');
            await load();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input
          data-testid="popup-new-research"
          placeholder="Nova pesquisa"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5"
        />
        <button
          type="submit"
          aria-label="Criar pesquisa"
          className="flex w-8 items-center justify-center rounded-md bg-orange-500 text-white hover:bg-orange-600"
        >
          <Plus size={15} aria-hidden />
        </button>
      </form>

      <button
        type="button"
        onClick={() => void send({ type: 'openLibrary' }).then(() => window.close())}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 py-2 hover:bg-neutral-50"
      >
        <FolderSearch size={15} aria-hidden /> Abrir biblioteca
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
