import { Replica, SIGNATURE_HEADERS, type Op } from '@cuepoint/core';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signRequest } from '../src/auth';
import { Helper } from '../src/helper';
import { HttpError, Lan } from '../src/lan';

const USER = '00000000-0000-4000-8000-000000000001';
const RESEARCH = '20000000-0000-4000-8000-000000000001';
const ids = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map(
  (p, i) => `${p}-0000-4000-8000-00000000000${'abc'[i]}`,
);

interface Node {
  helper: Helper;
  lan: Lan;
  replica: Replica;
}
const nodes: Node[] = [];
afterEach(async () => {
  while (nodes.length) {
    const n = nodes.pop()!;
    await n.lan.close();
    n.helper.close();
  }
});

async function node(i: number): Promise<Node> {
  const helper = new Helper({
    dataDir: mkdtempSync(join(tmpdir(), 'cp-lan-')),
    port: 0,
    pipe: 'unused',
  });
  await helper.start();
  const lan = new Lan(helper, () => ['127.0.0.1']);
  await lan.listen();
  await helper.handleLocal({
    type: 'hello',
    deviceId: ids[i]!,
    userId: USER,
    deviceName: `PC ${i}`,
  });
  const n = { helper, lan, replica: new Replica(ids[i]!, USER) };
  nodes.push(n);
  return n;
}

/** A "extensão" de cada nó grava operações locais no serviço. */
function edit(n: Node, changes: Record<string, unknown>) {
  if (!n.replica.get('research', RESEARCH)) {
    n.replica.receive(n.helper.db.opsSince(n.replica.vv).ops);
  }
  const op = n.replica.get('research', RESEARCH)
    ? n.replica.put('research', RESEARCH, changes as never)
    : n.replica.put('research', RESEARCH, {
        user_id: USER,
        name: 'R',
        description: '',
        archived: false,
        ...changes,
      } as never);
  n.helper.db.insertOps([op]);
}

const local = (n: Node, req: Record<string, unknown>) => n.helper.handleLocal(req as never);

/** Pareia `b` com `a` (b lê o código de a) e confirma em a, com política automática. */
async function pair(a: Node, b: Node) {
  const { uri } = (await local(a, { type: 'pairing:create' })) as { uri: string };
  const joined = (await local(b, { type: 'pairing:join', uri })) as { sas: string; peerId: string };
  await local(a, { type: 'peer:confirm', peerId: b.helper.identity!.deviceId });
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    await local(x, { type: 'peer:update', peerId: y.helper.identity!.deviceId, policy: 'auto' });
  }
  return joined;
}

describe('pareamento', () => {
  it('pareia, mostra o mesmo código nos dois lados e exige confirmação no PC', async () => {
    const a = await node(0);
    const b = await node(1);
    const { uri } = (await local(a, { type: 'pairing:create' })) as { uri: string };
    expect(uri).toMatch(/^cuepoint:\/\/pair\?/);
    const joined = (await local(b, { type: 'pairing:join', uri })) as { sas: string };
    const pending = a.helper.db.peer(ids[1]!)!;
    expect(pending.status).toBe('pending');
    expect(pending.sas).toBe(joined.sas);
    expect(joined.sas).toMatch(/^\d{6}$/);

    edit(b, { name: 'de B' });
    await local(b, { type: 'peer:update', peerId: ids[0], policy: 'auto' });
    const before = (await local(b, { type: 'peer:sync', peerId: ids[0] })) as {
      status: string;
      error?: string;
    };
    expect(before.error).toBe('pending_confirmation');

    await local(a, { type: 'peer:confirm', peerId: ids[1] });
    // política padrão do PC é "pedir aprovação"
    const asked = (await local(b, { type: 'peer:sync', peerId: ids[0] })) as { status: string };
    expect(asked.status).toBe('approval_required');
    expect(a.lan.pendingApprovals.has(ids[1]!)).toBe(true);
    await local(a, { type: 'approval:grant', peerId: ids[1] });
    const ok = (await local(b, { type: 'peer:sync', peerId: ids[0] })) as {
      status: string;
      sent: number;
    };
    expect(ok).toMatchObject({ status: 'ok', sent: 1 });
    expect(a.helper.db.count()).toBe(1);
  });

  it('recusa token reutilizado ou expirado e fingerprint errado', async () => {
    const a = await node(0);
    const b = await node(1);
    const c = await node(2);
    const { uri } = (await local(a, { type: 'pairing:create' })) as { uri: string };
    await local(b, { type: 'pairing:join', uri });
    await expect(local(c, { type: 'pairing:join', uri })).rejects.toThrow(/invalid_token/);

    const fresh = (await local(a, { type: 'pairing:create' })) as { uri: string };
    const wrongFp = fresh.uri.replace(/f=[0-9a-f]+/, `f=${'0'.repeat(64)}`);
    await expect(local(c, { type: 'pairing:join', uri: wrongFp })).rejects.toThrow(/certificado/);

    a.helper.opts.now = () => Date.now() + 6 * 60 * 1000;
    await expect(local(c, { type: 'pairing:join', uri: fresh.uri })).rejects.toThrow(
      /invalid_token/,
    );
  });
});

describe('sincronização entre serviços', () => {
  it('edições offline nos dois lados convergem, sem duplicar em syncs repetidas', async () => {
    const a = await node(0);
    const b = await node(1);
    await pair(a, b);
    edit(a, { name: 'A1' });
    await local(b, { type: 'peer:sync', peerId: ids[0] });
    edit(a, { description: 'offline em A' });
    b.replica.receive(b.helper.db.opsSince(b.replica.vv).ops);
    edit(b, { name: 'B1' });
    for (let i = 0; i < 3; i++) await local(b, { type: 'peer:sync', peerId: ids[0] });
    expect(a.helper.db.versionVector()).toEqual(b.helper.db.versionVector());
    expect(a.helper.db.count()).toBe(3);
    const ra = new Replica(ids[2]!, USER);
    ra.receive(a.helper.db.opsSince({}).ops);
    expect(ra.get('research', RESEARCH)).toMatchObject({ name: 'B1', description: 'offline em A' });
  });

  it('retransmite A → B → C sem contato direto entre A e C', async () => {
    const a = await node(0);
    const b = await node(1);
    const c = await node(2);
    await pair(a, b);
    await pair(b, c);
    edit(a, { name: 'nasceu em A' });
    await local(b, { type: 'peer:sync', peerId: ids[0] });
    await local(c, { type: 'peer:sync', peerId: ids[1] });
    expect(c.helper.db.opsSince({}).ops.map((o) => o.origin)).toEqual([ids[0]]);
  });

  it('sync interrompida no meio é retomada de forma idempotente', async () => {
    const a = await node(0);
    const b = await node(1);
    await pair(a, b);
    for (let i = 0; i < 1200; i++) edit(a, { description: `v${i}` });
    // B recebe só uma página e "cai"
    const page = (await b.lan.httpsJson(
      '127.0.0.1',
      a.lan.port,
      a.helper.keys.certFp,
      'POST',
      '/v1/sync/pull',
      JSON.stringify({ vv: {}, limit: 100 }),
      true,
    )) as { ops: Op[]; more: boolean };
    expect(page.more).toBe(true);
    b.helper.db.insertOps(page.ops);
    const res = (await local(b, { type: 'peer:sync', peerId: ids[0] })) as { received: number };
    expect(res.received).toBe(1100);
    expect(b.helper.db.count()).toBe(1200);
  });

  it('aparelho revogado é recusado', async () => {
    const a = await node(0);
    const b = await node(1);
    await pair(a, b);
    await local(a, { type: 'peer:revoke', peerId: ids[1] });
    const res = (await local(b, { type: 'peer:sync', peerId: ids[0] })) as {
      status: string;
      error?: string;
    };
    // a revogação também é avisada ao par
    expect(b.helper.db.peer(ids[0]!)?.status).toBe('revoked');
    expect(res.status).toBe('skipped');
  });
});

describe('autenticação das requisições', () => {
  async function raw(n: Node, headers: Record<string, string>, body = '{"vv":{}}') {
    return new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: n.lan.port,
          method: 'POST',
          path: '/v1/sync/pull',
          headers,
          rejectUnauthorized: false,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  it('recusa sem assinatura, assinatura adulterada e reenvio (replay)', async () => {
    const a = await node(0);
    const b = await node(1);
    await pair(a, b);
    expect(await raw(a, {})).toBe(401);
    const body = '{"vv":{}}';
    const h = signRequest({
      deviceId: ids[1]!,
      privateKey: b.helper.keys.privateKey,
      method: 'POST',
      path: '/v1/sync/pull',
      body,
    });
    expect(await raw(a, h, body)).toBe(200);
    expect(await raw(a, h, body)).toBe(401); // replay
    const h2 = signRequest({
      deviceId: ids[1]!,
      privateKey: b.helper.keys.privateKey,
      method: 'POST',
      path: '/v1/sync/pull',
      body,
    });
    expect(await raw(a, h2, '{"vv":{"x":1}}')).toBe(401); // corpo alterado
    const old = signRequest({
      deviceId: ids[1]!,
      privateKey: b.helper.keys.privateKey,
      method: 'POST',
      path: '/v1/sync/pull',
      body,
      now: Date.now() - 10 * 60 * 1000,
    });
    expect(await raw(a, old, body)).toBe(401);
    const stranger = signRequest({
      deviceId: ids[2]!,
      privateKey: b.helper.keys.privateKey,
      method: 'POST',
      path: '/v1/sync/pull',
      body,
    });
    expect(await raw(a, { ...stranger, [SIGNATURE_HEADERS.device]: ids[2]! }, body)).toBe(403);
    expect(HttpError).toBeDefined();
  });
});
