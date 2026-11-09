/**
 * Contrato compartilhado TS ⇄ Kotlin (spec/).
 *
 * Gera/verifica os arquivos de spec/vectors e spec/schema. Para regenerar após uma mudança
 * intencional: `npm run vectors -w @cuepoint/core` (vitest -u). Sem `-u`, qualquer diferença falha.
 * A suíte Kotlin lê os mesmos arquivos e precisa chegar ao mesmo resultado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  canonicalJson,
  conflictId,
  decisionId,
  deterministicId,
  ENTITY_SCHEMAS,
  formatHlc,
  keyBetween,
  opId,
  opSchema,
  playlistTrackId,
  Replica,
  trackCategoryId,
  trackIdFromUrn,
  validateOp,
  type EntityRecord,
  type Op,
} from '../src';
import { SCENARIOS } from './merge-scenarios';
import { IDS, runScenario } from './scenarios';

const spec = resolve(__dirname, '../../../spec');
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function canonicalRecords(records: EntityRecord[]): unknown {
  return JSON.parse(canonicalJson(records as never));
}

describe('vetores de mesclagem', () => {
  const vectors = SCENARIOS.map((s) => {
    const r = runScenario(s);
    return {
      name: r.name,
      description: r.description,
      ops: r.ops,
      expected: { records: canonicalRecords(r.records), conflicts: r.conflicts },
    };
  });

  it('spec/vectors/merge.json está atualizado', async () => {
    await expect(
      pretty({
        version: 1,
        description:
          'Cenários de mesclagem. Aplique `ops` (ordenadas por hlc) numa réplica vazia e compare com `expected`.',
        scenarios: vectors,
      }),
    ).toMatchFileSnapshot(resolve(spec, 'vectors/merge.json'));
  });

  it('aplicar as ops do arquivo numa réplica vazia reproduz o estado esperado', () => {
    const file = JSON.parse(readFileSync(resolve(spec, 'vectors/merge.json'), 'utf8')) as {
      scenarios: { name: string; ops: Op[]; expected: { records: unknown; conflicts: unknown } }[];
    };
    for (const sc of file.scenarios) {
      const fresh = new Replica('ffffffff-0000-4000-8000-00000000000f', IDS.user);
      fresh.receive(sc.ops.map(validateOp));
      const records = [...fresh.records.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, r]) => r);
      expect(canonicalRecords(records), sc.name).toEqual(sc.expected.records);
      expect(fresh.conflicts(), sc.name).toEqual(sc.expected.conflicts);
    }
  });
});

describe('vetores de ids e HLC', () => {
  it('spec/vectors/ids.json está atualizado', async () => {
    const urn = 'soundcloud:tracks:123456789';
    const track = trackIdFromUrn(urn);
    await expect(
      pretty({
        version: 1,
        namespace: 'uuidv5 com CUEPOINT_NAMESPACE',
        cases: [
          { fn: 'deterministicId', args: ['x'], expected: deterministicId('x') },
          { fn: 'trackIdFromUrn', args: [urn], expected: track },
          {
            fn: 'decisionId',
            args: [track, IDS.research1],
            expected: decisionId(track, IDS.research1),
          },
          {
            fn: 'trackCategoryId',
            args: [track, IDS.research1, IDS.categoryX],
            expected: trackCategoryId(track, IDS.research1, IDS.categoryX),
          },
          {
            fn: 'playlistTrackId',
            args: [IDS.research2, track],
            expected: playlistTrackId(IDS.research2, track),
          },
          { fn: 'opId', args: [IDS.deviceA, 42], expected: opId(IDS.deviceA, 42) },
          {
            fn: 'conflictId',
            args: ['research', IDS.research1, 'name'],
            expected: conflictId('research', IDS.research1, 'name'),
          },
        ],
        fractional: (
          [
            [null, null],
            ['V', null],
            [null, 'V'],
            ['V', 'k'],
            ['V', 'W'],
            ['Vz', 'W'],
            ['a1', 'a2'],
          ] as [string | null, string | null][]
        ).map(([a, b]) => ({ a, b, expected: keyBetween(a, b) })),
        hlc: [
          {
            parts: { ms: 1767225600000, counter: 7, node: IDS.deviceA },
            text: formatHlc({ ms: 1767225600000, counter: 7, node: IDS.deviceA }),
          },
          {
            parts: { ms: 0, counter: 0, node: 'n' },
            text: formatHlc({ ms: 0, counter: 0, node: 'n' }),
          },
        ],
      }),
    ).toMatchFileSnapshot(resolve(spec, 'vectors/ids.json'));
  });
});

describe('JSON Schema', () => {
  it('spec/schema/*.schema.json está atualizado', async () => {
    const entities = Object.fromEntries(
      Object.entries(ENTITY_SCHEMAS).map(([k, s]) => [k, z.toJSONSchema(s)]),
    );
    await expect(
      pretty({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'CuePoint — dados de domínio das entidades sincronizadas',
        description:
          'Gerado a partir de packages/core/src/model.ts. Cada registro também guarda id, created_at, updated_at, _v e _c.',
        entities,
      }),
    ).toMatchFileSnapshot(resolve(spec, 'schema/entities.schema.json'));
    await expect(pretty(z.toJSONSchema(opSchema))).toMatchFileSnapshot(
      resolve(spec, 'schema/op.schema.json'),
    );
  });
});

describe('vetores de compactação', () => {
  it('spec/vectors/compaction.json está atualizado', async () => {
    const { compactOps } = await import('../src');
    const now = (() => {
      let t = 1_767_225_600_000;
      return () => (t += 1000);
    })();
    const a = new Replica(IDS.deviceA, IDS.user, now);
    const b = new Replica(IDS.deviceB, IDS.user, now);
    a.put('category', IDS.categoryX, { user_id: IDS.user, name: 'Vocal', description: '' });
    b.receive(a.opsSince(b.vv));
    a.markSent(1);
    b.put('category', IDS.categoryX, { description: 'de B' });
    const tc = trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX);
    const data = { track_id: IDS.trackA, research_id: IDS.research1, category_id: IDS.categoryX };
    a.put('track_category', tc, data);
    a.receive(b.opsSince(a.vv));
    a.delete('track_category', tc);
    a.put('category', IDS.categoryX, { name: 'Vocais' });
    a.put('track_category', tc, data);
    const pending = a.log.filter((o) => o.origin === IDS.deviceA && o.seq > 1);
    await expect(
      pretty({
        version: 1,
        description:
          'compactOps(input, fromSeq): operações pendentes de um aparelho → operações compactadas.',
        cases: [{ fromSeq: 2, input: pending, expected: compactOps(pending, 2) }],
      }),
    ).toMatchFileSnapshot(resolve(spec, 'vectors/compaction.json'));
  });
});
