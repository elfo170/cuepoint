// @vitest-environment node
import 'fake-indexeddb/auto';
import { Replica, trackCategoryId } from '@cuepoint/core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Helper } from '../../helper/src/helper';
import { HelperLink, type PortLike } from '../src/background/helper-link';
import { Curation } from '../src/data/curation';
import { CuePointDB } from '../src/data/db';
import { Store } from '../src/data/store';

let n = 0;
const helpers: Helper[] = [];
afterEach(() => {
  while (helpers.length) helpers.pop()!.close();
});

async function makeHelper() {
  const h = new Helper({
    dataDir: mkdtempSync(join(tmpdir(), 'cp-link-')),
    port: 0,
    pipe: 'unused',
  });
  await h.start();
  helpers.push(h);
  return h;
}

/** Porta falsa: entrega as mensagens direto ao Helper, como o shim faria. */
function fakePort(helper: Helper): PortLike {
  const msgListeners: ((m: unknown) => void)[] = [];
  return {
    postMessage(msg) {
      const { id, req } = msg as { id: number; req: never };
      helper
        .handleLocal(req)
        .then((data) =>
          msgListeners.forEach((l) => l(JSON.parse(JSON.stringify({ id, ok: true, data })))),
        )
        .catch((e: Error) => msgListeners.forEach((l) => l({ id, ok: false, error: e.message })));
    },
    onMessage: { addListener: (fn) => void msgListeners.push(fn) },
    onDisconnect: { addListener: () => undefined },
    disconnect: () => undefined,
  };
}

function setup() {
  const store = new Store(new CuePointDB(`link-${Date.now()}-${n++}`));
  return { store, curation: new Curation(store) };
}

describe('HelperLink', () => {
  it('sem serviço instalado fica "ausente" e a extensão segue funcionando', async () => {
    const { store, curation } = setup();
    const link = new HelperLink(
      store,
      () => {
        throw new Error('Specified native messaging host not found.');
      },
      () => 'Specified native messaging host not found.',
    );
    expect(await link.connect()).toBe(false);
    await link.sync();
    expect(await curation.createResearch('Latin')).toBeDefined();
  });

  it('compacta, envia ao serviço e recebe operações de outros aparelhos', async () => {
    const helper = await makeHelper();
    const { store, curation } = setup();
    const link = new HelperLink(store, () => fakePort(helper));

    const r = await curation.createResearch('Peak Time');
    const t = await curation.ensureTrack({
      title: 'A',
      artist: 'B',
      url: null,
      urn: 'soundcloud:tracks:1',
      artworkUrl: null,
      source: 'dom',
    });
    const cat = await curation.createCategory('Vocal');
    // incluir → remover → incluir: vira uma operação ao compactar
    await curation.setTrackCategory(t.id, r.id, cat.id, true);
    await curation.setTrackCategory(t.id, r.id, cat.id, false);
    await curation.setTrackCategory(t.id, r.id, cat.id, true);
    const before = await store.db.sync_events.count();

    await link.sync();
    expect(link.status.state).toBe('connected');
    const after = await store.db.sync_events.count();
    expect(after).toBeLessThan(before);
    expect(helper.db.count()).toBe(after);
    expect(
      await store.db.sync_events.where('synchronization_status').equals('local_pending').count(),
    ).toBe(0);
    expect((await curation.decisionState(t.id, r.id)).categoryIds).toEqual([cat.id]);
    expect(
      (await store.db.track_categories.get(trackCategoryId(t.id, r.id, cat.id)))?.deleted_at,
    ).toBeNull();

    // Outro aparelho (ex.: celular) entrega operações ao serviço
    const phone = new Replica('bbbbbbbb-0000-4000-8000-00000000000b', (await store.init()).user.id);
    phone.receive(helper.db.opsSince({}).ops);
    phone.put('research', r.id, { description: 'do celular' });
    helper.db.insertOps(phone.opsSince(helper.db.versionVector()));

    await link.sync();
    expect((await store.get('research', r.id))?.description).toBe('do celular');
    // sincronizar de novo não duplica nada
    const count = await store.db.sync_events.count();
    await link.sync();
    expect(await store.db.sync_events.count()).toBe(count);
  });

  it('a compactação não altera o que já foi enviado', async () => {
    const helper = await makeHelper();
    const { store, curation } = setup();
    const link = new HelperLink(store, () => fakePort(helper));
    const r = await curation.createResearch('A');
    await curation.updateResearch(r.id, { name: 'B' });
    await link.sync();
    await curation.updateResearch(r.id, { name: 'C' });
    expect(await store.compactPending()).toBe(0);
    await curation.updateResearch(r.id, { name: 'D' });
    expect(await store.compactPending()).toBe(1);
    await link.sync();
    expect(helper.db.count()).toBe(await store.db.sync_events.count());
    expect((await store.get('research', r.id))?.name).toBe('D');
  });
});
