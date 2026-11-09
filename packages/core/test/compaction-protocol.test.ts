import fc from 'fast-check';
import { createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  canonicalRequest,
  compactOps,
  formatPairingUri,
  pairingCode,
  parsePairingUri,
  Replica,
  sha256Hex,
  trackCategoryId,
  type Op,
} from '../src';
import { fakeClock, IDS } from './scenarios';

const dump = (r: Replica) =>
  canonicalJson([...r.records.entries()].sort(([a], [b]) => a.localeCompare(b)) as never);

/** Valores de domínio (sem metadados de versão), para comparar com e sem compactação. */
const domain = (r: Replica) =>
  canonicalJson(
    [...r.records.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => {
        const { _v, _c, created_at, updated_at, ...rest } = v as unknown as Record<string, unknown>;
        void _v;
        void _c;
        void created_at;
        void updated_at;
        return [k, rest];
      }) as never,
  );

function send(from: Replica, to: Replica) {
  const ops = from.opsSince(to.vv);
  to.receive(ops);
  const own = ops.filter((o) => o.origin === from.deviceId).map((o) => o.seq);
  if (own.length) from.markSent(Math.max(...own));
}

describe('compactação de operações não enviadas', () => {
  it('incluir → remover → incluir a mesma categoria vira uma operação', () => {
    const now = fakeClock();
    const a = new Replica(IDS.deviceA, IDS.user, now);
    a.put('category', IDS.categoryX, { user_id: IDS.user, name: 'Vocal', description: '' });
    const b = new Replica(IDS.deviceB, IDS.user, now);
    send(a, b);
    const id = trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX);
    const data = { track_id: IDS.trackA, research_id: IDS.research1, category_id: IDS.categoryX };
    a.put('track_category', id, data);
    a.delete('track_category', id);
    a.put('track_category', id, data);
    const before = domain(a);
    expect(a.compactPending()).toBe(2);
    expect(a.log.filter((o) => o.seq > 1)).toHaveLength(1);
    expect(domain(a)).toBe(before);
    send(a, b);
    expect(dump(b)).toBe(dump(a));
    expect(a.log.map((o) => o.seq)).toEqual([1, 2]);
  });

  it('não toca no que já foi enviado', () => {
    const a = new Replica(IDS.deviceA, IDS.user, fakeClock());
    a.put('category', IDS.categoryX, { user_id: IDS.user, name: 'A', description: '' });
    a.put('category', IDS.categoryX, { name: 'B' });
    a.markSent(2);
    a.put('category', IDS.categoryX, { name: 'C' });
    expect(a.compactPending()).toBe(0);
  });

  it('propriedade: com compactação as réplicas convergem e sem concorrência o resultado é o mesmo', () => {
    const action = fc.record({
      who: fc.integer({ min: 0, max: 1 }),
      kind: fc.constantFrom('rename', 'describe', 'delete', 'tag', 'untag', 'sync', 'compact'),
      v: fc.constantFrom('x', 'y', 'z'),
    });
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        const now = fakeClock();
        const reps = [
          new Replica(IDS.deviceA, IDS.user, now),
          new Replica(IDS.deviceB, IDS.user, now),
        ];
        reps[0]!.put('research', IDS.research1, {
          user_id: IDS.user,
          name: 'R',
          description: '',
          archived: false,
        });
        send(reps[0]!, reps[1]!);
        const tc = trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX);
        for (const a of actions) {
          const r = reps[a.who]!;
          if (a.kind === 'rename') r.put('research', IDS.research1, { name: a.v });
          if (a.kind === 'describe') r.put('research', IDS.research1, { description: a.v });
          if (a.kind === 'delete') r.delete('research', IDS.research1);
          if (a.kind === 'tag')
            r.put('track_category', tc, {
              track_id: IDS.trackA,
              research_id: IDS.research1,
              category_id: IDS.categoryX,
            });
          if (a.kind === 'untag' && r.get('track_category', tc)) r.delete('track_category', tc);
          if (a.kind === 'sync') {
            send(reps[0]!, reps[1]!);
            send(reps[1]!, reps[0]!);
          }
          if (a.kind === 'compact') r.compactPending();
        }
        reps.forEach((r) => r.compactPending());
        send(reps[0]!, reps[1]!);
        send(reps[1]!, reps[0]!);
        expect(dump(reps[1]!)).toBe(dump(reps[0]!));
        expect(reps[1]!.conflicts()).toEqual(reps[0]!.conflicts());
        for (const r of reps) {
          const own = r.log
            .filter((o) => o.origin === r.deviceId)
            .map((o) => o.seq)
            .sort((x, y) => x - y);
          expect(own).toEqual(own.map((_, i) => i + 1));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('compactOps preserva o estado final de um único aparelho', () => {
    const a = new Replica(IDS.deviceA, IDS.user, fakeClock());
    a.put('research', IDS.research1, {
      user_id: IDS.user,
      name: 'R',
      description: '',
      archived: false,
    });
    a.put('research', IDS.research1, { name: 'S' });
    a.put('research', IDS.research1, { description: 'd' });
    const ops: Op[] = compactOps(a.log, 1);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      seq: 1,
      operation: 'create',
      fields: { name: 'S', description: 'd' },
    });
  });
});

const spec = resolve(__dirname, '../../../spec/vectors/protocol.json');

describe('protocolo', () => {
  it('payload de pareamento ida e volta', () => {
    const p = {
      v: 1,
      deviceId: IDS.deviceA,
      name: 'Chrome – Windows',
      addresses: ['192.168.0.10', '10.0.0.5'],
      port: 47800,
      certFp: 'ab'.repeat(32),
      publicKey: 'MFkw+/=',
      token: 'tok123',
    };
    expect(parsePairingUri(formatPairingUri(p))).toEqual(p);
    expect(() => parsePairingUri('https://x')).toThrow();
  });

  it('código de verificação é simétrico', async () => {
    const a = await pairingCode('t', 'K1', 'K2');
    expect(a).toMatch(/^\d{6}$/);
    expect(await pairingCode('t', 'K2', 'K1')).toBe(a);
    expect(await pairingCode('u', 'K1', 'K2')).not.toBe(a);
  });

  it('spec/vectors/protocol.json: string canônica, código e assinatura verificável', async () => {
    const body = '{"vv":{}}';
    const message = canonicalRequest(
      'post',
      '/v1/sync/pull',
      '1767225600000',
      'n0nce',
      await sha256Hex(body),
    );
    const expected = {
      canonical: {
        method: 'POST',
        path: '/v1/sync/pull',
        timestamp: '1767225600000',
        nonce: 'n0nce',
        body,
        message,
      },
      pairingCode: {
        token: 'tok123',
        keyA: 'KEY-A',
        keyB: 'KEY-B',
        code: await pairingCode('tok123', 'KEY-A', 'KEY-B'),
      },
      pairingUri: formatPairingUri({
        v: 1,
        deviceId: IDS.deviceA,
        name: 'PC do estúdio',
        addresses: ['192.168.0.10'],
        port: 47800,
        certFp: 'ab'.repeat(32),
        publicKey: 'MFkw',
        token: 'tok123',
      }),
    };
    if (!existsSync(spec)) {
      // Gera uma assinatura ECDSA P-256 (DER) uma única vez; depois só verifica.
      const { generateKeyPairSync } = await import('node:crypto');
      const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const signature = sign('sha256', Buffer.from(message), pair.privateKey).toString('base64');
      const publicKey = (pair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString(
        'base64',
      );
      writeFileSync(
        spec,
        `${JSON.stringify({ version: 1, ...expected, signature: { publicKey, signature } }, null, 2)}\n`,
      );
    }
    const file = JSON.parse(readFileSync(spec, 'utf8'));
    expect(file.canonical).toEqual(expected.canonical);
    expect(file.pairingCode).toEqual(expected.pairingCode);
    expect(file.pairingUri).toBe(expected.pairingUri);
    const pub = createPublicKey({
      key: Buffer.from(file.signature.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(file.canonical.message),
        pub,
        Buffer.from(file.signature.signature, 'base64'),
      ),
    ).toBe(true);
  });
});
