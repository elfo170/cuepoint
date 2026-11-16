import type { Playlist, SoundiizResult } from '@cuepoint/core';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { PlaylistItem } from '../../data/playlists';
import { buttonClass } from '../components';
import {
  openSoundiiz,
  soundiizBlock,
  soundiizBlockText,
  soundiizErrorText,
  soundiizExport,
} from '../soundiiz';

/** Selo da exportação que não depende de Artist Pro. */
export function FreeBadge() {
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
      Gratuito
    </span>
  );
}

type Done = Extract<SoundiizResult, { ok: true }>;

/**
 * Exportar para o SoundCloud sem Artist Pro, pelo Soundiiz (Sprint 18). Sempre visível, ao lado
 * do cartão Artist Pro. O CuePoint não guarda nada do Soundiiz: cada clique gera um link novo.
 */
export function SoundiizExport({ playlist, items }: { playlist: Playlist; items: PlaylistItem[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const block = soundiizBlock(items);

  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await soundiizExport(playlist, items);
      if (!r.ok) {
        setError(soundiizErrorText(r));
        return;
      }
      setResult(r);
      await openSoundiiz(r.shareUrl).catch(() => undefined); // o link fica no cartão
    } finally {
      setBusy(false);
    }
  };

  const expires = result
    ? new Date(result.expiresAt * 1000).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : null;

  return (
    <section
      data-testid="soundiiz-export-card"
      className="mb-4 space-y-2 rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">SoundCloud via Soundiiz</h2>
        <FreeBadge />
      </div>
      <p className="text-neutral-600 dark:text-neutral-400">
        O Soundiiz busca as músicas pelo nome e pode errar a versão. Revise antes de transferir.
      </p>
      {block && (
        <p className="text-amber-700" data-testid="soundiiz-blocked">
          {soundiizBlockText(block)}
        </p>
      )}
      <button
        type="button"
        className={buttonClass}
        disabled={busy || !!block}
        onClick={() => void send()}
        data-testid="soundiiz-export"
      >
        <ExternalLink size={14} aria-hidden /> Abrir no Soundiiz
      </button>
      {busy && <p className="text-neutral-500">Enviando ao Soundiiz…</p>}
      {error && (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-1" role="status">
          <p className="text-emerald-700">
            Link criado com {result.nbTracks} música(s), válido até {expires}.{' '}
            <a
              href={result.shareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Abrir de novo <ExternalLink size={12} aria-hidden />
            </a>
          </p>
          {result.nbTracks < items.length && (
            <p className="text-amber-700">
              O Soundiiz aceitou {result.nbTracks} de {items.length} músicas.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
