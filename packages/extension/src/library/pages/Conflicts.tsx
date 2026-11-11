import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, GitMerge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadConflicts, type ConflictView } from '../../data/conflicts';
import { send } from '../../shared/messages';
import { db, mutate, store } from '../api';
import { EmptyState, PageHeader, secondaryButtonClass } from '../components';
import type { PeerView } from './Pairing';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Nome dos aparelhos para mostrar a origem de cada valor (este PC + pares do serviço). */
function useDeviceNames(): Map<string, string> {
  const self = useLiveQuery(() => db.devices.where('pairing_status').equals('self').first(), []);
  const [peers, setPeers] = useState<PeerView[]>([]);
  useEffect(() => {
    send<PeerView[]>({ type: 'helper:request', req: { type: 'peers:list' } })
      .then(setPeers)
      .catch(() => setPeers([])); // sem o serviço auxiliar: mostra o id curto
  }, []);
  const names = new Map<string, string>();
  for (const p of peers) names.set(p.device_id, p.name);
  if (self) names.set(self.id, `${self.device_name} (este computador)`);
  return names;
}

function ConflictCard({ c, names }: { c: ConflictView; names: Map<string, string> }) {
  const [busy, setBusy] = useState(false);
  const origin = (id: string) => names.get(id) ?? `aparelho ${id.slice(0, 8)}`;
  return (
    <li className="space-y-3 p-4" data-testid="conflict-row">
      <div>
        <p className="text-xs tracking-wide text-neutral-500 uppercase">
          {c.kind} · {c.fieldLabel}
        </p>
        <p className="font-medium">{c.subject}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {c.options.map((o, i) => (
          <div
            key={i}
            data-testid="conflict-option"
            className={`flex flex-col gap-2 rounded-lg border p-3 ${
              o.current
                ? 'border-orange-300 bg-orange-50/60 dark:border-orange-800 dark:bg-orange-950/20'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <p className="font-medium break-words">{o.label}</p>
            <p className="text-xs text-neutral-500">
              {o.origins.map(origin).join(', ')} · {fmt(o.at)}
              {o.current && ' · exibido agora'}
            </p>
            <button
              type="button"
              disabled={busy}
              className={`${secondaryButtonClass} mt-auto self-start`}
              onClick={() => {
                setBusy(true);
                void mutate(() =>
                  store.resolve(c.entityType, c.entityId, c.field, o.value),
                ).finally(() => setBusy(false));
              }}
            >
              <CheckCircle2 size={15} aria-hidden /> Manter este
            </button>
          </div>
        ))}
      </div>
    </li>
  );
}

/**
 * Conflitos (PRD §5.6): o mesmo dado mudou em dois aparelhos antes de sincronizar. Até o
 * usuário escolher, vale o valor mais recente em todos os aparelhos; a escolha vira uma
 * operação que domina as duas versões e é sincronizada.
 */
export function ConflictsPage() {
  const conflicts = useLiveQuery(() => loadConflicts(db), []);
  const names = useDeviceNames();
  if (!conflicts) return null;
  return (
    <>
      <PageHeader
        title="Conflitos"
        subtitle="O mesmo dado mudou em dois aparelhos antes de sincronizar. Até você escolher, vale o mais recente."
      />
      {conflicts.length === 0 ? (
        <EmptyState>
          <GitMerge size={20} className="mx-auto mb-2 text-neutral-400" aria-hidden />
          Nenhum conflito. Tudo o que foi alterado nos aparelhos combinou sem divergência.
        </EmptyState>
      ) : (
        <ul
          data-testid="conflict-list"
          className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
        >
          {conflicts.map((c) => (
            <ConflictCard key={c.id} c={c} names={names} />
          ))}
        </ul>
      )}
    </>
  );
}
