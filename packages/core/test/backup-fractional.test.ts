import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BackupError,
  createBackup,
  ENTITY_TYPES,
  isValidFractionalKey,
  keyBetween,
  parseBackup,
  type BackupData,
  type EntityRecord,
  type EntityType,
} from '../src';
import { IDS, newWorld, seedCategory, seedResearch, seedTrack, decide } from './scenarios';
import { decisionId } from '../src';

describe('chaves fracionárias', () => {
  it('gera chaves no início, no fim e entre duas', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const first = keyBetween(null, a);
    const mid = keyBetween(a, b);
    expect([b, mid, a, first].sort()).toEqual([first, a, mid, b]);
    for (const k of [a, b, first, mid]) expect(isValidFractionalKey(k)).toBe(true);
  });

  it('sempre consegue inserir entre duas chaves válidas', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 60 }), (choices) => {
        const keys: string[] = [];
        for (const c of choices) {
          const i = keys.length ? c % (keys.length + 1) : 0;
          const k = keyBetween(keys[i - 1] ?? null, keys[i] ?? null);
          expect(isValidFractionalKey(k)).toBe(true);
          keys.splice(i, 0, k);
        }
        expect([...keys].sort()).toEqual(keys);
      }),
    );
  });
});

function sampleData(): BackupData {
  const { A } = newWorld();
  seedTrack(A);
  seedResearch(A, IDS.research1, 'Latin Bass');
  seedCategory(A, IDS.categoryX, 'Vocal');
  decide(A, IDS.trackA, IDS.research1, true, decisionId(IDS.trackA, IDS.research1));
  const entities = Object.fromEntries(ENTITY_TYPES.map((t) => [t, A.all(t)])) as Record<
    EntityType,
    EntityRecord[]
  >;
  return {
    entities,
    ops: A.log,
    users: [{ id: IDS.user, created_at: '2026-01-01T00:00:00.000Z' }],
    devices: [],
    conflicts: [],
    settings: {},
  };
}

describe('backup', () => {
  it('ida e volta preserva tudo e confere o checksum', async () => {
    const backup = await createBackup({
      data: sampleData(),
      deviceId: IDS.deviceA,
      userId: IDS.user,
      schemaVersion: 1,
    });
    expect(backup.counts).toMatchObject({
      track: 1,
      research: 1,
      category: 1,
      decision: 1,
      ops: 4,
    });
    const restored = await parseBackup(JSON.stringify(backup));
    expect(restored.data).toEqual(backup.data);
  });

  it('recusa arquivo truncado, adulterado, de outro formato ou com referência quebrada', async () => {
    const backup = await createBackup({
      data: sampleData(),
      deviceId: IDS.deviceA,
      userId: IDS.user,
      schemaVersion: 1,
    });
    const text = JSON.stringify(backup);
    await expect(parseBackup(text.slice(0, text.length / 2))).rejects.toThrow(/JSON/);
    await expect(parseBackup(text.replace('Latin Bass', 'Latin Base'))).rejects.toThrow(/Checksum/);
    await expect(parseBackup(JSON.stringify({ format: 'x' }))).rejects.toThrow(BackupError);

    const broken = sampleData();
    broken.entities.research = [];
    const bad = await createBackup({
      data: broken,
      deviceId: IDS.deviceA,
      userId: IDS.user,
      schemaVersion: 1,
    });
    await expect(parseBackup(JSON.stringify(bad))).rejects.toThrow(/Referência quebrada/);
  });
});
