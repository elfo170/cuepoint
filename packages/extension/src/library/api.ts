import { useLiveQuery } from 'dexie-react-hooks';
import { Curation } from '../data/curation';
import { CuePointDB } from '../data/db';
import { loadSnapshot, type Snapshot } from '../data/queries';
import { Store } from '../data/store';
import { send } from '../shared/messages';

/** Acesso direto ao IndexedDB da extensão (mesma origem do service worker). */
export const db = new CuePointDB();
export const store = new Store(db);
export const curation = new Curation(store);

/** Executa uma alteração e avisa o service worker (que atualiza os widgets abertos). */
export async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const result = await fn();
  try {
    await send({ type: 'notifyChanged' });
  } catch {
    // Service worker indisponível: o widget se atualiza na próxima consulta.
  }
  return result;
}

/** Snapshot reativo da biblioteca (atualiza sozinho a cada escrita no IndexedDB). */
export function useSnapshot(): Snapshot | undefined {
  return useLiveQuery(() => loadSnapshot(db), []);
}
