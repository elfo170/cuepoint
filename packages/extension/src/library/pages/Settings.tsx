import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { db, mutate, store } from '../api';
import { buttonClass, inputClass, PageHeader } from '../components';
import { SoundCloudSettings } from './SoundCloudSettings';

/** Configurações do aparelho (PRD §4.3: nome automático inicial, personalizável). */
export function SettingsPage() {
  const info = useLiveQuery(async () => {
    // Somente leitura (liveQuery não permite escrita); a identidade é criada em main.tsx.
    const identity = (await db.meta.get('identity'))?.value as
      { userId: string; deviceId: string } | undefined;
    const device = identity ? await db.devices.get(identity.deviceId) : undefined;
    if (!identity || !device) return null;
    return {
      device,
      userId: identity.userId,
      ops: await db.sync_events.count(),
      pending: await db.sync_events.where('synchronization_status').equals('local_pending').count(),
      conflicts: await db.conflicts.count(),
    };
  }, []);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (info) setName(info.device.device_name);
  }, [info?.device.device_name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return null;

  return (
    <>
      <PageHeader title="Configurações" />
      <section className="mb-8 max-w-xl rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 font-semibold">Este aparelho</h2>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await mutate(() => store.renameDevice(name));
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          <input
            aria-label="Nome do aparelho"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <button type="submit" className={buttonClass} disabled={!name.trim()}>
            Salvar
          </button>
        </form>
        {saved && (
          <p role="status" className="mt-2 text-sm text-emerald-700">
            Nome salvo.
          </p>
        )}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-500">Id do aparelho</dt>
          <dd>
            <code className="text-xs" data-testid="device-id">
              {info.device.id}
            </code>
          </dd>
          <dt className="text-neutral-500">Id do usuário</dt>
          <dd>
            <code className="text-xs">{info.userId}</code>
          </dd>
          <dt className="text-neutral-500">Criado em</dt>
          <dd>{new Date(info.device.created_at).toLocaleString('pt-BR')}</dd>
        </dl>
      </section>

      <SoundCloudSettings />

      <section className="max-w-xl rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-1 font-semibold">Registro de alterações</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Todas as alterações ficam registradas num log local, que é o que a sincronização troca com
          os outros aparelhos. Nada é apagado automaticamente.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-500">Operações registradas</dt>
          <dd data-testid="ops-count">{info.ops}</dd>
          <dt className="text-neutral-500">Ainda não entregues ao serviço auxiliar</dt>
          <dd>{info.pending}</dd>
          <dt className="text-neutral-500">Conflitos abertos</dt>
          <dd>
            {info.conflicts}
            {info.conflicts > 0 && (
              <Link to="/conflicts" className="ml-2 text-orange-700 underline">
                resolver
              </Link>
            )}
          </dd>
        </dl>
      </section>
    </>
  );
}
