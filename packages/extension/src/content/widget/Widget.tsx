import { Check, ChevronDown, GripVertical, Minus, Music2, Plus, Tag, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NowPlaying } from '../soundcloud/types';

export interface Option {
  id: string;
  name: string;
}

export interface WidgetProps {
  track: NowPlaying | null;
  researches: Option[];
  activeResearchId: string | null;
  onSelectResearch: (id: string) => void;
  onCreateResearch: (name: string) => void;
  /** Decisão da faixa atual na pesquisa ativa: true, false ou null (não avaliada). */
  decision: boolean | null;
  onApprove: () => void;
  onReject: () => void;
  categories: Option[];
  assignedCategoryIds: string[];
  pickerOpen: boolean;
  onToggleCategory: (id: string) => void;
  onCreateCategory: (name: string) => void;
  onClosePicker: () => void;
  onOpenPicker: () => void;
  onOpenLibrary?: () => void;
  message?: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  position: { right: number; bottom: number };
  onPositionChange: (pos: { right: number; bottom: number }) => void;
}

const NEW_RESEARCH = '__new__';

function decisionLabel(decision: boolean | null): string {
  if (decision === true) return 'Aprovada';
  if (decision === false) return 'Rejeitada';
  return 'Não avaliada';
}

export function Widget(props: WidgetProps) {
  const {
    track,
    researches,
    activeResearchId,
    decision,
    categories,
    assignedCategoryIds,
    pickerOpen,
    collapsed,
    position,
  } = props;
  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [brokenArtwork, setBrokenArtwork] = useState<string | null>(null);
  const [creatingResearch, setCreatingResearch] = useState(false);
  const [newResearch, setNewResearch] = useState('');
  const canDecide = !!track && !!activeResearchId;

  useEffect(() => {
    if (!pickerOpen) setNewCategory('');
  }, [pickerOpen]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ...position };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const right = Math.max(0, Math.min(window.innerWidth - 80, d.right - (e.clientX - d.x)));
    const bottom = Math.max(0, Math.min(window.innerHeight - 40, d.bottom - (e.clientY - d.y)));
    props.onPositionChange({ right, bottom });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const style = { right: `${position.right}px`, bottom: `${position.bottom}px` };

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="cuepoint-expand"
        aria-label="Abrir CuePoint"
        title="Abrir CuePoint"
        onClick={() => props.onCollapsedChange(false)}
        style={style}
        className="fixed flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-orange-500 text-white shadow-lg hover:bg-orange-600"
      >
        <Music2 size={20} aria-hidden />
      </button>
    );
  }

  return (
    <section
      data-testid="cuepoint-widget"
      aria-label="CuePoint"
      style={style}
      className="fixed w-80 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900/95 font-sans text-sm text-neutral-100 shadow-2xl"
    >
      <header
        className="flex cursor-grab items-center gap-1 border-b border-neutral-800 px-2 py-1 select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical size={14} className="text-neutral-500" aria-hidden />
        <button
          type="button"
          onClick={props.onOpenLibrary}
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold tracking-wide text-orange-400 uppercase"
          title="Abrir biblioteca"
        >
          CuePoint
        </button>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Minimizar"
          title="Minimizar"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onCollapsedChange(true)}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-800 hover:text-white"
        >
          <Minus size={14} aria-hidden />
        </button>
      </header>

      <div className="flex gap-3 p-3">
        {track?.artworkUrl && brokenArtwork !== track.artworkUrl ? (
          <img
            src={track.artworkUrl}
            alt=""
            onError={() => setBrokenArtwork(track.artworkUrl)}
            className="h-14 w-14 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-neutral-800">
            <Music2 size={22} className="text-neutral-500" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p data-testid="cuepoint-title" className="truncate font-semibold" title={track?.title}>
            {track?.title ?? 'Nenhuma faixa tocando'}
          </p>
          <p
            data-testid="cuepoint-artist"
            className="truncate text-neutral-400"
            title={track?.artist}
          >
            {track?.artist ?? 'Dê play no SoundCloud'}
          </p>
          {track && !track.urn && (
            <p className="mt-0.5 text-[11px] text-amber-400" data-testid="cuepoint-provisional">
              Identificação provisória
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Pesquisa ativa</span>
          <select
            data-testid="cuepoint-research"
            value={activeResearchId ?? ''}
            onChange={(e) => {
              if (e.target.value === NEW_RESEARCH) setCreatingResearch(true);
              else props.onSelectResearch(e.target.value);
            }}
            className="w-full cursor-pointer appearance-none truncate rounded-md border border-neutral-700 bg-neutral-800 py-1.5 pr-7 pl-2 text-neutral-100"
          >
            {!activeResearchId && <option value="">Escolha uma pesquisa</option>}
            {researches.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value={NEW_RESEARCH}>+ Nova pesquisa…</option>
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
        </label>
        <button
          type="button"
          data-testid="cuepoint-reject"
          aria-label="Rejeitar"
          title="Rejeitar"
          aria-pressed={decision === false}
          disabled={!canDecide}
          onClick={props.onReject}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            decision === false
              ? 'border-red-500 bg-red-500 text-white'
              : 'border-red-500/70 bg-transparent text-red-400 hover:bg-red-500/15'
          }`}
        >
          <X size={18} strokeWidth={3} aria-hidden />
        </button>
        <button
          type="button"
          data-testid="cuepoint-approve"
          aria-label="Aprovar"
          title="Aprovar"
          aria-pressed={decision === true}
          disabled={!canDecide}
          onClick={props.onApprove}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            decision === true
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-emerald-500/70 bg-transparent text-emerald-400 hover:bg-emerald-500/15'
          }`}
        >
          <Check size={18} strokeWidth={3} aria-hidden />
        </button>
      </div>

      {creatingResearch && (
        <form
          data-testid="cuepoint-research-form"
          className="flex gap-1.5 px-3 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newResearch.trim();
            if (name) props.onCreateResearch(name);
            setNewResearch('');
            setCreatingResearch(false);
          }}
        >
          <input
            data-testid="cuepoint-new-research"
            autoFocus
            value={newResearch}
            onChange={(e) => setNewResearch(e.target.value)}
            placeholder="Nome da pesquisa"
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500"
          />
          <button
            type="submit"
            aria-label="Criar pesquisa"
            title="Criar pesquisa"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-neutral-700 text-white hover:bg-neutral-600"
          >
            <Check size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Cancelar"
            title="Cancelar"
            onClick={() => setCreatingResearch(false)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-800"
          >
            <X size={14} aria-hidden />
          </button>
        </form>
      )}

      <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-1.5 text-xs">
        <span data-testid="cuepoint-decision" aria-live="polite" className="text-neutral-400">
          {decisionLabel(decision)}
        </span>
        {decision === true && (
          <button
            type="button"
            data-testid="cuepoint-open-picker"
            onClick={props.onOpenPicker}
            className="ml-auto flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-neutral-300 hover:text-white"
          >
            <Tag size={12} aria-hidden />
            {assignedCategoryIds.length
              ? `${assignedCategoryIds.length} categoria(s)`
              : 'Sem categoria'}
          </button>
        )}
      </div>

      {props.message && (
        <p
          data-testid="cuepoint-message"
          role="status"
          className="border-t border-neutral-800 px-3 py-1.5 text-xs text-amber-300"
        >
          {props.message}
        </p>
      )}

      {pickerOpen && (
        <div data-testid="cuepoint-picker" className="border-t border-neutral-800 p-3">
          <div className="mb-2 flex items-center">
            <span className="text-xs font-semibold text-neutral-300">Categorias</span>
            <button
              type="button"
              data-testid="cuepoint-picker-close"
              aria-label="Fechar seletor"
              title="Fechar"
              onClick={props.onClosePicker}
              className="ml-auto flex h-6 w-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {categories.length === 0 && (
              <span className="text-xs text-neutral-500">Nenhuma categoria ainda.</span>
            )}
            {categories.map((c) => {
              const on = assignedCategoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  data-testid="cuepoint-category"
                  onClick={() => props.onToggleCategory(c.id)}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                    on
                      ? 'border-orange-500 bg-orange-500 text-white'
                      : 'border-neutral-600 bg-transparent text-neutral-200 hover:border-neutral-400'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newCategory.trim();
              if (name) props.onCreateCategory(name);
              setNewCategory('');
            }}
          >
            <input
              data-testid="cuepoint-new-category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Nova categoria"
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500"
            />
            <button
              type="submit"
              aria-label="Criar categoria"
              title="Criar categoria"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-neutral-700 text-white hover:bg-neutral-600"
            >
              <Plus size={14} aria-hidden />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
