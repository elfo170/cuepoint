import type { Category, Track } from '@cuepoint/core';
import { Check, ExternalLink, Music2, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        {props.subtitle && <p className="mt-1 text-sm text-neutral-500">{props.subtitle}</p>}
      </div>
      {props.actions}
    </header>
  );
}

export function EmptyState(props: { children: ReactNode }) {
  return (
    <div
      data-testid="empty-state"
      className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700"
    >
      {props.children}
    </div>
  );
}

export function TrackCell({ track }: { track: Track }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {track.artwork_url && !broken ? (
        <img
          src={track.artwork_url}
          alt=""
          onError={() => setBroken(true)}
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-200 dark:bg-neutral-800">
          <Music2 size={16} className="text-neutral-500" aria-hidden />
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium" data-testid="track-title">
            {track.title}
          </span>
          {track.soundcloud_url && (
            <a
              href={track.soundcloud_url}
              target="_blank"
              rel="noreferrer"
              title="Abrir no SoundCloud"
              className="text-neutral-400 hover:text-orange-500"
            >
              <ExternalLink size={13} aria-hidden />
              <span className="sr-only">Abrir no SoundCloud</span>
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span className="truncate">{track.artist || '—'}</span>
          {!track.soundcloud_urn && (
            <span
              data-testid="provisional-badge"
              className="rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            >
              provisória
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CategoryChips(props: {
  categories: Category[];
  selected: string[];
  onToggle: (id: string) => void;
  testId?: string;
}) {
  if (!props.categories.length)
    return <span className="text-sm text-neutral-500">Nenhuma categoria criada.</span>;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={props.testId}>
      {props.categories.map((c) => {
        const on = props.selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => props.onToggle(c.id)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
              on
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-neutral-300 text-neutral-700 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-300'
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

/** Botões ✓ / ✗ com o estado atual; clicar no estado ativo volta para "não avaliada". */
export function DecisionButtons(props: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  size?: 'sm' | 'md';
}) {
  const dim = props.size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const icon = props.size === 'sm' ? 14 : 16;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Rejeitar"
        title={props.value === false ? 'Remover decisão' : 'Rejeitar'}
        aria-pressed={props.value === false}
        onClick={() => props.onChange(props.value === false ? null : false)}
        className={`flex ${dim} items-center justify-center rounded-full border-2 ${
          props.value === false
            ? 'border-red-500 bg-red-500 text-white'
            : 'border-red-400/60 text-red-500 hover:bg-red-500/10'
        }`}
      >
        <X size={icon} strokeWidth={3} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Aprovar"
        title={props.value === true ? 'Remover decisão' : 'Aprovar'}
        aria-pressed={props.value === true}
        onClick={() => props.onChange(props.value === true ? null : true)}
        className={`flex ${dim} items-center justify-center rounded-full border-2 ${
          props.value === true
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-emerald-400/60 text-emerald-600 hover:bg-emerald-500/10'
        }`}
      >
        <Check size={icon} strokeWidth={3} aria-hidden />
      </button>
    </div>
  );
}

/** Botão que pede confirmação antes de executar uma ação destrutiva. */
export function ConfirmButton(props: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  testId?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          data-testid={props.testId ? `${props.testId}-confirm` : undefined}
          onClick={() => {
            setAsking(false);
            props.onConfirm();
          }}
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          {props.confirmLabel ?? 'Confirmar exclusão'}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Cancelar
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid={props.testId}
      title={props.label}
      onClick={() => setAsking(true)}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
    >
      <Trash2 size={13} aria-hidden />
      {props.label}
    </button>
  );
}

export const inputClass =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-orange-500 dark:border-neutral-700 dark:bg-neutral-900';

export const buttonClass =
  'inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50';

export const secondaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';
