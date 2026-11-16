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

/** Guia de instalação do serviço do PC (README, seção 6.1). */
const INSTALL_GUIDE =
  'https://github.com/elfo170/cuepoint#61-instalar-o-servi%C3%A7o-do-pc-uma-vez';

function HelperCard({ status, onSync }: { status: HelperStatus | null; onSync: () => void }) {
  if (!status) return null;
  const ok = status.state === 'connected';
  let body: ReactNode;
  if (ok) {
    body = (
      <p className="text-sm">
        <span className="text-neutral-500">Última sincronização:</span>{' '}
        {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('pt-BR') : '—'}
      </p>
    );
  } else if (status.state === 'absent') {
    body = (
      <p className="text-sm">
        Instale o serviço do PC para sincronizar com o celular.{' '}
        <a
          href={INSTALL_GUIDE}
          target="_blank"
          rel="noreferrer"
          className="text-orange-600 underline"
        >
          Como instalar
        </a>
      </p>
    );
  } else if (status.state === 'connecting') {
    body = <p className="text-sm text-neutral-500">Conectando…</p>;
  } else {
    body = <p className="text-sm text-red-600">Não foi possível falar com o serviço do PC.</p>;
  }
  return (
    <section
      data-testid="helper-card"
      className="mb-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <div className="mb-3 flex items-center gap-2">
        <Server size={16} aria-hidden />
        <h2 className="font-semibold">Serviço de sincronização</h2>
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
      <PageHeader title="Dispositivos" subtitle="Sincronização via Wi-Fi." />
      <HelperCard status={status} onSync={() => void send({ type: 'helper:sync' }).then(reload)} />
      {status?.state === 'connected' && props.children}
    </>
  );
}
