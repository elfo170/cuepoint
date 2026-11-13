import { Check, Copy, ExternalLink, LogIn, LogOut, Music2, Smartphone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonClass, ConfirmButton, inputClass, secondaryButtonClass } from '../components';
import {
  APP_FORM,
  SC_APPS_URL,
  scRequest,
  useSoundCloud,
  type ScShareDevice,
  type ScStatus,
  type ScView,
} from '../soundcloud';

/** Selo exibido em tudo que depende da API do SoundCloud. */
export function ArtistProBadge() {
  return (
    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-200">
      Requer Artist Pro
    </span>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 text-neutral-500">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
        {value}
      </code>
      <button
        type="button"
        aria-label={`Copiar ${label}`}
        className={secondaryButtonClass}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

/** Sem Artist Pro: explica e aponta os exports locais. */
function WithoutPro({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Para exportar direto para o SoundCloud, cada pessoa registra o próprio app na API do
        SoundCloud, e o registro exige uma assinatura <strong>Artist Pro</strong>. Sem ela, o
        CuePoint não consegue criar playlists na sua conta.
      </p>
      <p>
        Você continua podendo exportar qualquer playlist como lista de links, CSV ou JSON (na página
        da playlist) e montar a playlist no SoundCloud a partir desses links.
      </p>
      <button type="button" className={secondaryButtonClass} onClick={onBack}>
        Voltar
      </button>
    </div>
  );
}

/** Passos 2 a 4: criar o app no SoundCloud e informar as credenciais. */
function CredentialsForm({ status, onSaved }: { status: ScStatus; onSaved: () => void }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4 text-sm">
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <p className="mb-2">
            Abra a página de apps do SoundCloud, entre com a sua conta Artist Pro e registre um app
            novo.
          </p>
          <a href={SC_APPS_URL} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
            <ExternalLink size={14} aria-hidden /> Abrir soundcloud.com/you/apps
          </a>
        </li>
        <li>
          <p className="mb-2">Preencha o cadastro com estes valores:</p>
          <div className="space-y-1.5">
            <CopyField label="Nome do app" value={APP_FORM.name} />
            <CopyField label="Descrição" value={APP_FORM.description} />
            <CopyField label="Site / privacidade" value={APP_FORM.website} />
            <CopyField label="Endereço de retorno" value={status.redirectUri} />
          </div>
        </li>
        <li>
          <p className="mb-2">
            Depois de salvar, o SoundCloud mostra o <em>Client ID</em> e o <em>Client Secret</em>.
            Cole os dois aqui:
          </p>
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await scRequest({ type: 'sc:configure', clientId, clientSecret: secret });
                setSecret('');
                onSaved();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block">
              <span className="mb-1 block text-neutral-500">Código do app (Client ID)</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-neutral-500">Senha do app (Client Secret)</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
            </label>
            <p className="text-neutral-500">
              Os dois ficam neste PC, guardados pelo serviço do CuePoint e cifrados com a sua conta
              do Windows. Você pode enviá-los uma vez a um celular pareado; nunca vão pela
              sincronização nem para nenhum servidor.
            </p>
            {error && <p className="text-red-600">{error}</p>}
            <button
              type="submit"
              className={buttonClass}
              disabled={busy || !clientId.trim() || !secret.trim()}
            >
              {busy ? 'Conferindo…' : 'Salvar e conferir'}
            </button>
          </form>
        </li>
      </ol>
    </div>
  );
}

const remaining = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function ShareRow({ device, reload }: { device: ScShareDevice; reload: () => Promise<void> }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = device.expiresAt !== null && device.expiresAt > now;
  useEffect(() => {
    if (device.expiresAt === null) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= device.expiresAt!) void reload();
    }, 1000);
    return () => clearInterval(t);
  }, [device.expiresAt, reload]);
  const run = (type: 'sc:share' | 'sc:share-cancel') => async () => {
    setBusy(true);
    setError(null);
    try {
      await scRequest({ type, peerId: device.peerId });
      setNow(Date.now());
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-1" data-testid={`sc-share-${device.peerId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{device.name}</span>
        {device.sharedAt && !active && (
          <span className="text-neutral-500">
            Enviado em {new Date(device.sharedAt).toLocaleString('pt-BR')}
          </span>
        )}
        {active ? (
          <button
            type="button"
            className={`${secondaryButtonClass} ml-auto`}
            disabled={busy}
            onClick={run('sc:share-cancel')}
          >
            Cancelar
          </button>
        ) : (
          <button
            type="button"
            className={`${secondaryButtonClass} ml-auto`}
            disabled={busy}
            onClick={run('sc:share')}
          >
            <Smartphone size={14} aria-hidden /> Enviar para {device.name}
          </button>
        )}
      </div>
      {active && (
        <p className="text-orange-700 dark:text-orange-300">
          Liberado por {remaining(device.expiresAt! - now)}. No celular, abra Configurações →
          SoundCloud → <strong>Receber do PC</strong>.
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </li>
  );
}

/**
 * "Usar no celular" (Sprint 16.2): libera as credenciais do app para um aparelho pareado buscar
 * uma vez, em até 10 minutos. O celular faz o próprio login (tokens não são compartilhados).
 */
export function PhoneShare({ status, reload }: { status: ScStatus; reload: () => Promise<void> }) {
  return (
    <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <p className="font-medium">Usar no celular</p>
      {status.devices.length ? (
        <>
          <p className="text-neutral-500">
            Envie o código e a senha do app para um celular pareado, uma vez. O envio vale por 10
            minutos e passa só pela conexão cifrada do pareamento; o celular faz o próprio login.
          </p>
          <ul className="space-y-2">
            {status.devices.map((d) => (
              <ShareRow key={d.peerId} device={d} reload={reload} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-neutral-500">
          Nenhum celular pareado. Pareie em{' '}
          <Link to="/devices" className="text-orange-600 underline">
            Dispositivos
          </Link>{' '}
          para exportar também pelo app Android.
        </p>
      )}
    </div>
  );
}

function Connection({ status, reload }: { status: ScStatus; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const login = run(async () => {
    const { url } = await scRequest<{ url: string }>({ type: 'sc:login' });
    await chrome.tabs.create({ url });
  });

  if (editing)
    return (
      <CredentialsForm
        status={status}
        onSaved={() => {
          setEditing(false);
          void reload();
        }}
      />
    );

  let main: ReactNode;
  if (status.state === 'connected') {
    main = (
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="sc-connected">
          Conectado como{' '}
          {status.user?.permalinkUrl ? (
            <a
              href={status.user.permalinkUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              @{status.user.username}
            </a>
          ) : (
            <strong>@{status.user?.username ?? '…'}</strong>
          )}
        </span>
        <button
          type="button"
          className={`${secondaryButtonClass} ml-auto`}
          disabled={busy}
          onClick={run(() => scRequest({ type: 'sc:logout' }))}
        >
          <LogOut size={14} aria-hidden /> Desconectar
        </button>
      </div>
    );
  } else {
    const reconnect = status.state === 'reconnect';
    main = (
      <div className="space-y-2">
        {reconnect && (
          <p className="text-amber-700">
            O acesso ao SoundCloud caiu (senha do app trocada, Artist Pro vencido ou autorização
            revogada). Entre de novo; se continuar falhando, confira as credenciais.
          </p>
        )}
        {status.loginPending ? (
          <p>Aguardando você autorizar o CuePoint na aba do SoundCloud…</p>
        ) : (
          <button type="button" className={buttonClass} disabled={busy} onClick={login}>
            <LogIn size={14} aria-hidden /> {reconnect ? 'Reconectar' : 'Entrar com SoundCloud'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {main}
      {(error ?? status.lastError) && <p className="text-red-600">{error ?? status.lastError}</p>}
      <PhoneShare status={status} reload={reload} />
      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3 text-neutral-500 dark:border-neutral-800">
        <span>App: {status.clientId}</span>
        <button
          type="button"
          className={`${secondaryButtonClass} ml-auto`}
          onClick={() => setEditing(true)}
        >
          Trocar credenciais
        </button>
        <ConfirmButton
          label="Remover credenciais"
          confirmLabel="Remover mesmo"
          testId="sc-forget"
          onConfirm={() => void run(() => scRequest({ type: 'sc:forget' }))()}
        />
      </div>
    </div>
  );
}

function Body({ view, reload }: { view: ScView; reload: () => Promise<void> }) {
  const [pro, setPro] = useState<'ask' | 'yes' | 'no'>('ask');
  if (view.kind === 'loading') return <p className="text-sm text-neutral-500">Carregando…</p>;
  if (view.kind === 'no-helper')
    return (
      <p className="text-sm">
        A exportação usa o serviço do CuePoint neste PC. {view.reason} Veja em{' '}
        <Link to="/devices" className="text-orange-600 underline">
          Dispositivos
        </Link>
        .
      </p>
    );
  const { status } = view;
  if (status.state !== 'unconfigured') return <Connection status={status} reload={reload} />;
  if (pro === 'no') return <WithoutPro onBack={() => setPro('ask')} />;
  if (pro === 'yes') return <CredentialsForm status={status} onSaved={() => void reload()} />;
  return (
    <div className="space-y-2 text-sm">
      <p>
        O CuePoint pode criar e atualizar playlists na sua conta do SoundCloud. Para isso você
        registra o seu próprio app na API do SoundCloud, o que exige <strong>Artist Pro</strong>.
      </p>
      <p className="font-medium">Você tem Artist Pro?</p>
      <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={() => setPro('yes')}>
          Tenho Artist Pro
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => setPro('no')}>
          Não tenho
        </button>
      </div>
    </div>
  );
}

/** Seção "SoundCloud" das Configurações: assistente de credenciais e conexão (Sprint 15). */
export function SoundCloudSettings() {
  const [view, reload] = useSoundCloud();
  return (
    <section
      id="soundcloud"
      data-testid="sc-settings"
      className="mb-8 max-w-xl rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <div className="mb-3 flex items-center gap-2">
        <Music2 size={16} aria-hidden />
        <h2 className="font-semibold">Exportar para o SoundCloud</h2>
        <ArtistProBadge />
      </div>
      <Body view={view} reload={reload} />
    </section>
  );
}
