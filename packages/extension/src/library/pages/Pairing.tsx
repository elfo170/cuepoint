import {
  Check,
  Copy,
  Link2,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { CHANGED_MESSAGE, send } from '../../shared/messages';
import {
  buttonClass,
  ConfirmButton,
  EmptyState,
  inputClass,
  secondaryButtonClass,
} from '../components';

export interface PeerView {
  device_id: string;
  name: string;
  status: 'pending' | 'paired' | 'revoked';
  policy: 'auto' | 'ask';
  sas: string | null;
  cert_fp: string | null;
  last_sync_at: string | null;
  last_seen_at: string | null;
  approval_pending: boolean;
  approved_until: number | null;
}

const helperRequest = <T,>(req: Record<string, unknown>) =>
  send<T>({ type: 'helper:request', req });

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

/** "Adicionar dispositivo": QR temporário de uso único (5 min) + código em texto (PRD §4.4). */
function AddDevice({ onDone }: { onDone: () => void }) {
  const [pairing, setPairing] = useState<{ uri: string; expiresAt: number; qr: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const create = useCallback(async () => {
    try {
      const r = await helperRequest<{ uri: string; expiresAt: number }>({ type: 'pairing:create' });
      setPairing({ ...r, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 280 }) });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void create();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [create]);

  const left = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;
  return (
    <div
      data-testid="pairing-panel"
      className="mb-6 rounded-xl border border-orange-300 p-4 dark:border-orange-800"
    >
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <QrCode size={16} aria-hidden /> Adicionar dispositivo
      </h3>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {pairing && (
        <div className="flex flex-wrap gap-6">
          <img
            src={pairing.qr}
            alt="QR Code de pareamento"
            className="h-56 w-56 rounded bg-white p-1"
          />
          <div className="min-w-0 flex-1 space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                No celular, abra o CuePoint → Configurações → Dispositivos →{' '}
                <strong>Parear com PC</strong>.
              </li>
              <li>Escaneie o QR (ou cole o código abaixo).</li>
              <li>
                Confira se o código de 6 dígitos é o mesmo nos dois aparelhos e confirme aqui.
              </li>
            </ol>
            <p className="text-neutral-500">
              {left > 0
                ? `Válido por mais ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                : 'Expirado.'}{' '}
              O QR só estabelece a confiança entre os aparelhos — ele não contém a sua biblioteca.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={pairing.uri}
                aria-label="Código de pareamento"
                className={`${inputClass} font-mono text-xs`}
                data-testid="pairing-uri"
              />
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => {
                  void navigator.clipboard.writeText(pairing.uri);
                  setCopied(true);
                }}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} Copiar
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => void create()}>
                <RefreshCw size={14} aria-hidden /> Novo código
              </button>
              <button type="button" className={secondaryButtonClass} onClick={onDone}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Parear com outro computador colando o código dele (PCs não têm câmera). */
function JoinDevice({ onDone }: { onDone: () => void }) {
  const [uri, setUri] = useState('');
  const [result, setResult] = useState<{ name: string; sas: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mb-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          setResult(
            await helperRequest<{ name: string; sas: string }>({
              type: 'pairing:join',
              uri: uri.trim(),
            }),
          );
          setError(null);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <Link2 size={16} aria-hidden /> Parear com outro computador
      </h3>
      {result ? (
        <p className="text-sm">
          Pareado com <strong>{result.name}</strong>. Código de verificação:{' '}
          <strong className="font-mono text-lg">{result.sas}</strong> — confirme no outro
          computador.
        </p>
      ) : (
        <div className="flex gap-2">
          <input
            aria-label="Código do outro computador"
            placeholder="cuepoint://pair?…"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            className={`${inputClass} font-mono text-xs`}
          />
          <button type="submit" className={buttonClass} disabled={!uri.trim()}>
            Parear
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={onDone}>
        Fechar
      </button>
    </form>
  );
}

export function PeersSection() {
  const [peers, setPeers] = useState<PeerView[] | null>(null);
  const [mode, setMode] = useState<'none' | 'add' | 'join'>('none');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeers(await helperRequest<PeerView[]>({ type: 'peers:list' }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const onMsg = (m: { type?: string }) => m?.type === CHANGED_MESSAGE && void load();
    chrome.runtime.onMessage.addListener(onMsg);
    const t = setInterval(load, 5000);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      clearInterval(t);
    };
  }, [load]);

  const act = (req: Record<string, unknown>) =>
    helperRequest(req)
      .then(load)
      .catch((e: Error) => setError(e.message));

  const visible = (peers ?? []).filter((p) => p.status !== 'revoked');
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Aparelhos pareados</h2>
        <button type="button" className={buttonClass} onClick={() => setMode('add')}>
          <Smartphone size={15} aria-hidden /> Adicionar dispositivo
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => setMode('join')}>
          <Link2 size={15} aria-hidden /> Parear com outro PC
        </button>
      </div>
      {mode === 'add' && <AddDevice onDone={() => setMode('none')} />}
      {mode === 'join' && <JoinDevice onDone={() => setMode('none')} />}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {peers && visible.length === 0 ? (
        <EmptyState>
          Nenhum aparelho pareado. Use “Adicionar dispositivo” e escaneie o QR no celular.
        </EmptyState>
      ) : (
        <ul
          data-testid="peer-list"
          className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
        >
          {visible.map((p) => (
            <li key={p.device_id} className="space-y-2 p-4" data-testid="peer-row">
              <div className="flex flex-wrap items-center gap-3">
                <Smartphone size={16} className="text-neutral-500" aria-hidden />
                <span className="font-medium">{p.name}</span>
                {p.status === 'pending' && (
                  <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">
                    aguardando confirmação
                  </span>
                )}
                <span className="ml-auto text-sm text-neutral-500">
                  Última sync: {fmt(p.last_sync_at)}
                </span>
              </div>
              {p.status === 'pending' && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                  <ShieldAlert size={16} className="text-amber-600" aria-hidden />
                  <span>
                    Confira se o celular mostra o código{' '}
                    <strong className="font-mono text-lg" data-testid="peer-sas">
                      {p.sas}
                    </strong>
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void act({ type: 'peer:confirm', peerId: p.device_id })}
                  >
                    Confirmar pareamento
                  </button>
                  <ConfirmButton
                    label="Recusar"
                    confirmLabel="Recusar aparelho"
                    onConfirm={() => void act({ type: 'peer:revoke', peerId: p.device_id })}
                  />
                </div>
              )}
              {p.approval_pending && p.status === 'paired' && (
                <div className="flex items-center gap-3 rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-950/30">
                  <span>{p.name} quer sincronizar.</span>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void act({ type: 'approval:grant', peerId: p.device_id })}
                  >
                    Permitir
                  </button>
                </div>
              )}
              {p.status === 'paired' && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    Sincronização
                    <select
                      aria-label={`Política de ${p.name}`}
                      value={p.policy}
                      onChange={(e) =>
                        void act({
                          type: 'peer:update',
                          peerId: p.device_id,
                          policy: e.target.value,
                        })
                      }
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="ask">Pedir aprovação</option>
                      <option value="auto">Automática</option>
                    </select>
                  </label>
                  {p.cert_fp && (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => void act({ type: 'peer:sync', peerId: p.device_id })}
                    >
                      <RefreshCw size={14} aria-hidden /> Sincronizar
                    </button>
                  )}
                  <ConfirmButton
                    label="Revogar"
                    confirmLabel="Revogar aparelho"
                    onConfirm={() => void act({ type: 'peer:revoke', peerId: p.device_id })}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex items-center gap-1 text-xs text-neutral-500">
        <Trash2 size={12} aria-hidden /> Revogar impede novas sincronizações e invalida as
        credenciais do aparelho.
      </p>
    </section>
  );
}
