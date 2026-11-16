import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, mutate, store } from '../api';
import { buttonClass, inputClass, PageHeader } from '../components';
import { SoundCloudSettings } from './SoundCloudSettings';

/** Configurações do aparelho (PRD §4.3: nome automático inicial, personalizável). */
export function SettingsPage() {
  const info = useLiveQuery(async () => {
    // Somente leitura (liveQuery não permite escrita); a identidade é criada em main.tsx.
    const identity = (await db.meta.get('identity'))?.value as { deviceId: string } | undefined;
    const device = identity ? await db.devices.get(identity.deviceId) : undefined;
    if (!identity || !device) return null;
    return { device };
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
      </section>

      <SoundCloudSettings />
    </>
  );
}
