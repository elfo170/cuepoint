import { CheckCircle2, CircleAlert, RefreshCw, Server } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CHANGED_MESSAGE, send } from '../../shared/messages';
import { PageHeader, secondaryButtonClass } from '../components';

export interface HelperStatus {
  state: 'absent' | 'connecting' | 'connected' | 'error';
  error: string | null;
  lastSyncAt: string | null;
  info: {
    ops?: number;
    port?: number;
    certFp?: string;
    dataDir?: string;
    identity?: { name: string } | null;
  } | null;
}

/** Estado do serviço auxiliar, atualizado quando os dados mudam. */
export function useHelperStatus(): [HelperStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const load = useCallback(async () => {
    try {
      setStatus(await send<HelperStatus>({ type: 'helper:status' }));
    } catch (e) {
      setStatus({ state: 'error', error: (e as Error).message, info: null, lastSyncAt: null });
    }
  }, []);
  useEffect(() => {
    void load();
    const onMsg = (m: { type?: string }) => m?.type === CHANGED_MESSAGE && void load();
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [load]);
  return [status, load];
}

function HelperCard({ status, onSync }: { status: HelperStatus | null; onSync: () => void }) {
  if (!status) return null;
  const ok = status.state === 'connected';
  let body: ReactNode;
  if (ok) {
    body = (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-500">Operações na réplica</dt>
        <dd data-testid="helper-ops">{status.info?.ops ?? 0}</dd>
        <dt className="text-neutral-500">Porta na rede local</dt>
        <dd>{status.info?.port}</dd>
        <dt className="text-neutral-500">Última sincronização local</dt>
        <dd>{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('pt-BR') : '—'}</dd>
        <dt className="text-neutral-500">Dados</dt>
        <dd className="truncate">{status.info?.dataDir}</dd>
      </dl>
    );
  } else if (status.state === 'absent') {
    body = (
      <div className="space-y-2 text-sm">
        <p>
          O serviço auxiliar não está instalado. Sem ele o CuePoint funciona normalmente neste
          computador, mas não sincroniza com o celular ou outros aparelhos.
        </p>
        <p>
          Para instalar, rode no PowerShell, na pasta do projeto:{' '}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
            npm run helper:install
          </code>
        </p>
      </div>
    );
  } else {
    body = <p className="text-sm text-red-600">{status.error ?? 'Conectando…'}</p>;
  }
  return (
    <section
      data-testid="helper-card"
      className="mb-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <div className="mb-3 flex items-center gap-2">
        <Server size={16} aria-hidden />
        <h2 className="font-semibold">Serviço auxiliar</h2>
        <span
          data-testid="helper-state"
          className={`ml-2 inline-flex items-center gap-1 text-sm ${ok ? 'text-emerald-600' : 'text-amber-600'}`}
        >
          {ok ? <CheckCircle2 size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
          {ok
            ? 'conectado'
            : status.state === 'absent'
              ? 'não instalado'
              : status.state === 'connecting'
                ? 'conectando'
                : 'erro'}
        </span>
        {ok && (
          <button type="button" className={`${secondaryButtonClass} ml-auto`} onClick={onSync}>
            <RefreshCw size={14} aria-hidden /> Sincronizar agora
          </button>
        )}
      </div>
      {body}
    </section>
  );
}

export function DevicesPage(props: { children?: ReactNode }) {
  const [status, reload] = useHelperStatus();
  return (
    <>
      <PageHeader
        title="Dispositivos"
        subtitle="Sincronização direta pela rede Wi-Fi local, sem servidor externo."
      />
      <HelperCard status={status} onSync={() => void send({ type: 'helper:sync' }).then(reload)} />
      {status?.state === 'connected' && props.children}
    </>
  );
}
