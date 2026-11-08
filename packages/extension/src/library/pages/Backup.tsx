import { BackupError, parseBackup, type Backup } from '@cuepoint/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { HardDriveDownload, ShieldCheck, Upload } from 'lucide-react';
import { useState } from 'react';
import {
  DEFAULT_BACKUP_SETTINGS,
  restoreBackup,
  type BackupRecord,
  type BackupSettings,
} from '../../data/backup';
import { send } from '../../shared/messages';
import { db, mutate, store } from '../api';
import { buttonClass, inputClass, PageHeader, secondaryButtonClass } from '../components';

const INTERVALS = [
  { value: 0, label: 'Desligado' },
  { value: 6, label: 'A cada 6 horas' },
  { value: 12, label: 'A cada 12 horas' },
  { value: 24, label: 'Diário' },
  { value: 168, label: 'Semanal' },
];

const LABELS: Record<string, string> = {
  track: 'músicas',
  research: 'pesquisas',
  decision: 'decisões',
  category: 'categorias',
  track_category: 'classificações',
  playlist: 'playlists',
  playlist_track: 'itens de playlist',
  ops: 'operações',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR');
}

export function BackupPage() {
  const meta = useLiveQuery(async () => {
    const rows = await db.meta.bulkGet(['backup.settings', 'backup.history']);
    return {
      settings: { ...DEFAULT_BACKUP_SETTINGS, ...((rows[0]?.value as BackupSettings) ?? {}) },
      history: (rows[1]?.value as BackupRecord[] | undefined) ?? [],
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);

  if (!meta) return null;

  const saveSettings = async (next: Partial<BackupSettings>) => {
    await store.setMeta('backup.settings', { ...meta.settings, ...next });
    await send({ type: 'backup:reschedule' }).catch(() => undefined);
  };

  const backupNow = async () => {
    setBusy(true);
    try {
      const record = await send<BackupRecord | null>({ type: 'backup:run', reason: 'manual' });
      setMessage({ kind: 'ok', text: `Backup salvo em Downloads/${record?.filename ?? ''}` });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Backup"
        subtitle="Backups automáticos em arquivos locais (pasta Downloads/CuePoint/backups). Nenhum backup antigo é apagado."
      />

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-semibold">Backup automático</h2>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-neutral-500">Frequência</span>
            <select
              aria-label="Frequência do backup"
              value={meta.settings.intervalHours}
              onChange={(e) => void saveSettings({ intervalHours: Number(e.target.value) })}
              className={inputClass}
            >
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-500">
              Também após N alterações (0 = desligado)
            </span>
            <input
              aria-label="Backup após alterações"
              type="number"
              min={0}
              step={10}
              value={meta.settings.everyChanges}
              onChange={(e) =>
                void saveSettings({ everyChanges: Math.max(0, Number(e.target.value) || 0) })
              }
              className={inputClass}
            />
          </label>
        </div>

        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-semibold">Agora</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void backupNow()}
            >
              <HardDriveDownload size={15} aria-hidden /> Fazer backup agora
            </button>
            <label className={`${secondaryButtonClass} cursor-pointer`}>
              <Upload size={15} aria-hidden /> Restaurar de arquivo…
              <input
                data-testid="restore-input"
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setMessage(null);
                  try {
                    setPending(await parseBackup(await file.text()));
                  } catch (err) {
                    setPending(null);
                    setMessage({
                      kind: 'error',
                      text:
                        err instanceof BackupError
                          ? err.message
                          : `Falha ao ler: ${(err as Error).message}`,
                    });
                  }
                }}
              />
            </label>
          </div>
          {message && (
            <p
              role="status"
              data-testid="backup-message"
              className={`mt-3 text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
            >
              {message.text}
            </p>
          )}
        </div>
      </section>

      {pending && (
        <section
          data-testid="restore-preview"
          className="mb-8 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
        >
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <ShieldCheck size={16} className="text-emerald-600" aria-hidden /> Backup válido
            (checksum conferido)
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Criado em {formatDate(pending.created_at)} ·{' '}
            {Object.entries(pending.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${n} ${LABELS[k] ?? k}`)
              .join(' · ')}
          </p>
          <p className="mt-2 text-sm">
            Restaurar <strong>substitui</strong> a biblioteca atual. Antes disso é feito um backup
            de segurança do estado atual.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await send({ type: 'backup:run', reason: 'pre-restore' });
                  await mutate(async () => {
                    await restoreBackup(store, pending);
                    await send({ type: 'store:reset' });
                  });
                  setPending(null);
                  setMessage({ kind: 'ok', text: 'Biblioteca restaurada.' });
                } catch (err) {
                  setMessage({ kind: 'error', text: (err as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restaurar
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setPending(null)}>
              Cancelar
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Histórico</h2>
        {meta.history.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum backup feito ainda.</p>
        ) : (
          <ul
            data-testid="backup-history"
            className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800"
          >
            {meta.history.map((h) => (
              <li key={h.at + h.filename} className="flex flex-wrap items-center gap-3 p-3">
                <span className="font-medium">{formatDate(h.at)}</span>
                <span className="text-neutral-500">
                  {h.reason === 'auto'
                    ? 'automático'
                    : h.reason === 'manual'
                      ? 'manual'
                      : 'antes de restaurar'}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">{h.filename}</span>
                <span className="text-neutral-500">{(h.bytes / 1024).toFixed(1)} KB</span>
                <code className="text-xs text-neutral-400" title={h.sha256}>
                  {h.sha256.slice(0, 12)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
