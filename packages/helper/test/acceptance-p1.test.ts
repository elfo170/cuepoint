/**
 * Teste de aceite do P1 (PLANEJAMENTO, Sprint 10): dois aparelhos pareados trocam alterações,
 * inclusive depois de ficarem offline, sem duplicação e sem perda silenciosa — todo conflito
 * aparece nos dois lados e a resolução converge.
 *
 * Cada nó é um serviço auxiliar real (Helper + Lan, HTTPS na LAN) com uma réplica no papel da
 * extensão, que grava no serviço e lê dele como a extensão faz.
 */
import { canonicalJson, decisionId, Replica } from '@cuepoint/core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Helper } from '../src/helper';
import { Lan } from '../src/lan';

const USER = '00000000-0000-4000-8000-000000000001';
const ID = {
  a: 'aaaaaaaa-0000-4000-8000-00000000000a',
  b: 'bbbbbbbb-0000-4000-8000-00000000000b',
  research: '20000000-0000-4000-8000-000000000001',
  research2: '20000000-0000-4000-8000-000000000002',
  category: '30000000-0000-4000-8000-000000000001',
  track: '10000000-0000-4000-8000-000000000001',
};

interface Node {
  id: string;
  helper: Helper;
  lan: Lan;
  /** A "extensão" deste aparelho. */
  ext: Replica;
}
const nodes: Node[] = [];
afterEach(async () => {
  while (nodes.length) {
    const n = nodes.pop()!;
    await n.lan.close();
    n.helper.close();
  }
});

async function node(id: string, name: string): Promise<Node> {
  const helper = new Helper({
    dataDir: mkdtempSync(join(tmpdir(), 'cp-p1-')),
    port: 0,
    pipe: 'unused',
  });
  await helper.start();
  const lan = new Lan(helper, () => ['127.0.0.1']);
  await lan.listen();
  await helper.handleLocal({
    type: 'hello',
    deviceId: id,
    userId: USER,
    deviceName: name,
  } as never);
  const n = { id, helper, lan, ext: new Replica(id, USER) };
  nodes.push(n);
  return n;
}

const local = <T>(n: Node, req: Record<string, unknown>) =>
  n.helper.handleLocal(req as never) as Promise<T>;

/** Extensão → serviço (o que ela gravou) e serviço → extensão (o que chegou de fora). */
function linkExtension(n: Node) {
  n.helper.db.insertOps(n.ext.opsSince(n.helper.db.versionVector()));
  n.ext.receive(n.helper.db.opsSince(n.ext.vv).ops);
}

async function pair(a: Node, b: Node) {
  const { uri } = await local<{ uri: string }>(a, { type: 'pairing:create' });
  await local(b, { type: 'pairing:join', uri });
  await local(a, { type: 'peer:confirm', peerId: b.id });
  await local(a, { type: 'peer:update', peerId: b.id, policy: 'auto' });
  await local(b, { type: 'peer:update', peerId: a.id, policy: 'auto' });
}

/** Sincroniza b com a pela LAN e repassa às duas extensões. */
async function syncAll(a: Node, b: Node) {
  linkExtension(a);
  linkExtension(b);
  const r = await local<{ status: string }>(b, { type: 'peer:sync', peerId: a.id });
  expect(r.status).toBe('ok');
  linkExtension(a);
  linkExtension(b);
}

const pendingFor = async (n: Node, peer: string) =>
  (await local<{ device_id: string; pending: number | null }[]>(n, { type: 'peers:list' })).find(
    (p) => p.device_id === peer,
  )!.pending;

const dump = (r: Replica) => canonicalJson([...r.records.entries()].sort() as never);

describe('aceite do P1: dois aparelhos pareados', () => {
  it('trocam alterações feitas offline, sem duplicar e sem perda silenciosa', async () => {
    const a = await node(ID.a, 'PC');
    const b = await node(ID.b, 'Celular');
    await pair(a, b);

    // Base comum: pesquisa, categoria e faixa criadas no PC.
    a.ext.put('research', ID.research, {
      user_id: USER,
      name: 'Techno',
      description: '',
      archived: false,
    });
    a.ext.put('category', ID.category, { user_id: USER, name: 'Vocal', description: '' });
    a.ext.put('track', ID.track, {
      soundcloud_urn: 'soundcloud:tracks:1',
      soundcloud_url: 'https://soundcloud.com/a/t',
      title: 'Track',
      artist: 'Artist',
      artwork_url: null,
      metadata_source: 'dom',
      merged_into: null,
    });
    await syncAll(a, b);
    expect(dump(b.ext)).toBe(dump(a.ext));
    expect(await pendingFor(b, a.id)).toBe(0);
    expect(await pendingFor(a, b.id)).toBe(0);

    // Offline: cada lado altera sem ver o outro.
    a.ext.put('research', ID.research, { name: 'Techno Groovy' }); // conflita com B
    a.ext.delete('category', ID.category); // B edita a mesma categoria
    a.ext.put('decision', decisionId(ID.track, ID.research), {
      user_id: USER,
      track_id: ID.track,
      research_id: ID.research,
      decision: true,
      device_source: ID.a,
    }); // independente
    b.ext.put('research', ID.research, { name: 'Techno Peak' });
    b.ext.put('category', ID.category, { description: 'vozes' });
    b.ext.put('research', ID.research2, {
      user_id: USER,
      name: 'Latin',
      description: '',
      archived: false,
    });
    linkExtension(a);
    linkExtension(b);
    expect(await pendingFor(b, a.id)).toBe(3); // as 3 alterações do celular ainda não foram ao PC
    expect(await pendingFor(a, b.id)).toBe(3);

    await syncAll(a, b);

    // Mesmo estado nos dois lados, sem operações duplicadas.
    expect(dump(b.ext)).toBe(dump(a.ext));
    const opIds = a.helper.db.opsSince({}).ops.map((o) => o.op_id);
    expect(new Set(opIds).size).toBe(opIds.length);
    expect(b.helper.db.count()).toBe(a.helper.db.count());
    // Alterações independentes chegaram aos dois.
    expect(b.ext.get('decision', decisionId(ID.track, ID.research))?.decision).toBe(true);
    expect(a.ext.get('research', ID.research2)?.name).toBe('Latin');
    // Todo conflito aparece, igual nos dois lados (nada decidido em silêncio).
    const expected = [
      { entity_type: 'category', entity_id: ID.category, field: 'deleted_at' },
      { entity_type: 'research', entity_id: ID.research, field: 'name' },
    ];
    expect(a.ext.conflicts()).toEqual(expected);
    expect(b.ext.conflicts()).toEqual(expected);
    expect(await pendingFor(b, a.id)).toBe(0);
    expect(await pendingFor(a, b.id)).toBe(0);

    // Resolução no celular converge nos dois lados.
    b.ext.resolve('research', ID.research, 'name', 'Techno Peak');
    b.ext.resolve('category', ID.category, 'deleted_at', null);
    linkExtension(b);
    expect(await pendingFor(b, a.id)).toBe(2);
    await syncAll(a, b);
    expect(a.ext.conflicts()).toEqual([]);
    expect(b.ext.conflicts()).toEqual([]);
    expect(dump(b.ext)).toBe(dump(a.ext));
    expect(a.ext.get('research', ID.research)?.name).toBe('Techno Peak');
    expect(a.ext.get('category', ID.category)?.deleted_at).toBeNull();
    expect(a.ext.get('category', ID.category)?.description).toBe('vozes');

    // Repetir a sincronização não muda nada.
    const before = a.helper.db.count();
    await syncAll(a, b);
    await syncAll(a, b);
    expect(a.helper.db.count()).toBe(before);
    expect(b.helper.db.count()).toBe(before);
  });
});
