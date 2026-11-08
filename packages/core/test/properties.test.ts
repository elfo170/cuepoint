import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, decisionId, Replica, syncPair, trackCategoryId, type Op } from '../src';
import { fakeClock, IDS } from './scenarios';

/**
 * Propriedades do motor de mesclagem:
 * 1. Convergência: após sincronização completa, todas as réplicas têm o mesmo estado,
 *    qualquer que seja a ordem das operações e das sincronizações.
 * 2. Idempotência: reentregar todo o log não altera nada.
 * 3. Nenhuma perda: toda operação criada aparece no log de todas as réplicas.
 */

const researches = [IDS.research1, IDS.research2];
const categories = [IDS.categoryX, IDS.categoryY];
const tracks = [IDS.trackA, IDS.trackB];

type Action =
  | { kind: 'rename'; device: number; research: number; name: string }
  | { kind: 'describe'; device: number; research: number; text: string }
  | { kind: 'decide'; device: number; track: number; research: number; value: boolean }
  | { kind: 'tag'; device: number; track: number; research: number; category: number; on: boolean }
  | { kind: 'deleteResearch'; device: number; research: number }
  | { kind: 'sync'; a: number; b: number };

const idx = (n: number) => fc.integer({ min: 0, max: n - 1 });
const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant('rename' as const),
    device: idx(3),
    research: idx(2),
    name: fc.constantFrom('A', 'B', 'C'),
  }),
  fc.record({
    kind: fc.constant('describe' as const),
    device: idx(3),
    research: idx(2),
    text: fc.constantFrom('x', 'y'),
  }),
  fc.record({
    kind: fc.constant('decide' as const),
    device: idx(3),
    track: idx(2),
    research: idx(2),
    value: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant('tag' as const),
    device: idx(3),
    track: idx(2),
    research: idx(2),
    category: idx(2),
    on: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('deleteResearch' as const), device: idx(3), research: idx(2) }),
  fc.record({ kind: fc.constant('sync' as const), a: idx(3), b: idx(3) }),
);

function setup() {
  const now = fakeClock();
  const reps = [IDS.deviceA, IDS.deviceB, IDS.deviceC].map((d) => new Replica(d, IDS.user, now));
  const seed = reps[0]!;
  for (const [i, r] of researches.entries())
    seed.put('research', r, { user_id: IDS.user, name: `R${i}`, description: '', archived: false });
  for (const [i, c] of categories.entries())
    seed.put('category', c, { user_id: IDS.user, name: `C${i}`, description: '' });
  for (const [i, t] of tracks.entries())
    seed.put('track', t, {
      soundcloud_urn: `soundcloud:tracks:${i + 1}`,
      soundcloud_url: null,
      title: `T${i}`,
      artist: 'X',
      artwork_url: null,
      metadata_source: 'dom',
      merged_into: null,
    });
  syncPair(reps[0]!, reps[1]!);
  syncPair(reps[0]!, reps[2]!);
  return reps;
}

function perform(reps: Replica[], a: Action): Op | null {
  switch (a.kind) {
    case 'sync':
      if (a.a !== a.b) syncPair(reps[a.a]!, reps[a.b]!);
      return null;
    case 'rename':
      return reps[a.device]!.put('research', researches[a.research]!, { name: a.name });
    case 'describe':
      return reps[a.device]!.put('research', researches[a.research]!, { description: a.text });
    case 'deleteResearch':
      return reps[a.device]!.delete('research', researches[a.research]!);
    case 'decide': {
      const t = tracks[a.track]!;
      const r = researches[a.research]!;
      const rep = reps[a.device]!;
      return rep.put('decision', decisionId(t, r), {
        user_id: IDS.user,
        track_id: t,
        research_id: r,
        decision: a.value,
        device_source: rep.deviceId,
      });
    }
    case 'tag': {
      const t = tracks[a.track]!;
      const r = researches[a.research]!;
      const c = categories[a.category]!;
      const rep = reps[a.device]!;
      const id = trackCategoryId(t, r, c);
      if (a.on)
        return rep.put('track_category', id, { track_id: t, research_id: r, category_id: c });
      if (!rep.get('track_category', id)) return null;
      return rep.delete('track_category', id);
    }
  }
}

const dump = (r: Replica) =>
  canonicalJson([...r.records.entries()].sort(([a], [b]) => a.localeCompare(b)) as never);

function fullSync(reps: Replica[]) {
  for (let round = 0; round < 2; round++)
    for (let i = 0; i < reps.length; i++)
      for (let j = i + 1; j < reps.length; j++) syncPair(reps[i]!, reps[j]!);
}

describe('propriedades da mesclagem', () => {
  it('converge, é idempotente e não perde operações', () => {
    fc.assert(
      fc.property(
        fc.array(action, { maxLength: 40 }),
        fc.integer({ min: 0, max: 2 }),
        (actions, order) => {
          const reps = setup();
          const created: Op[] = [];
          for (const a of actions) {
            const op = perform(reps, a);
            if (op) created.push(op);
          }
          // Ordem final de sincronização varia (rotação das réplicas)
          fullSync([...reps.slice(order), ...reps.slice(0, order)]);

          const states = reps.map(dump);
          expect(states[1]).toBe(states[0]);
          expect(states[2]).toBe(states[0]);
          expect(reps[1]!.conflicts()).toEqual(reps[0]!.conflicts());

          for (const r of reps) {
            const ids = new Set(r.log.map((o) => o.op_id));
            for (const op of created) expect(ids.has(op.op_id)).toBe(true);
            expect(ids.size).toBe(r.log.length);
          }

          const before = dump(reps[0]!);
          reps[0]!.receive(reps[1]!.log);
          reps[0]!.receive(reps[2]!.log);
          expect(dump(reps[0]!)).toBe(before);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('o estado final independe da ordem causal de aplicação do log', () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 30 }), fc.integer(), (actions, seed) => {
        const reps = setup();
        for (const a of actions) perform(reps, a);
        fullSync(reps);
        const log = reps[0]!.log;
        // Reaplica o log numa réplica nova, entregando as operações em lotes aleatórios;
        // cada lote é ordenado por HLC (entrega causal), como no protocolo de sync.
        const fresh = new Replica('dddddddd-0000-4000-8000-00000000000d', IDS.user, fakeClock());
        const sorted = [...log].sort((x, y) => (x.hlc < y.hlc ? -1 : 1));
        let i = 0;
        let s = Math.abs(seed) || 1;
        while (i < sorted.length) {
          s = (s * 1103515245 + 12345) % 2 ** 31;
          const size = 1 + (s % 7);
          fresh.receive(sorted.slice(i, i + size));
          i += size;
        }
        expect(dump(fresh)).toBe(dump(reps[0]!));
      }),
      { numRuns: 200 },
    );
  });
});
