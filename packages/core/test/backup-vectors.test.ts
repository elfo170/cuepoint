/**
 * Vetores de backup compartilhados TS ⇄ Kotlin (restauração cruzada Chrome ⇄ Android).
 *
 * - `spec/vectors/backup.json` é gerado aqui: um backup válido (com tombstone, conflito e textos
 *   com acentos/aspas) e variantes inválidas com a mensagem de erro esperada. A suíte Kotlin
 *   valida o mesmo arquivo e precisa chegar ao mesmo checksum e às mesmas mensagens.
 * - `spec/vectors/backup-android.json` é gerado pela suíte Kotlin (backup feito pelo app Android);
 *   aqui ele precisa ser aceito e restaurável.
 *
 * Regenerar após mudança intencional: `npm run vectors -w @cuepoint/core`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BackupError,
  canonicalJson,
  conflictFields,
  conflictId,
  CUEPOINT_SCHEMA_VERSION,
  createBackup,
  decisionId,
  ENTITY_TYPES,
  parseBackup,
  playlistTrackId,
  Replica,
  syncPair,
  trackCategoryId,
  validateBackup,
  type Backup,
  type BackupData,
  type EntityRecord,
  type EntityType,
  type JsonValue,
} from '../src';
import { fakeClock, IDS, START_MS, seedCategory, seedResearch, seedTrack } from './scenarios';

const spec = resolve(__dirname, '../../../spec');
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function dataOf(r: Replica): BackupData {
  const entities = {} as Record<EntityType, EntityRecord[]>;
  const conflicts: Record<string, JsonValue>[] = [];
  for (const type of ENTITY_TYPES) {
    entities[type] = r.all(type).sort((a, b) => a.id.localeCompare(b.id));
    for (const rec of entities[type]) {
      for (const field of conflictFields(rec)) {
        conflicts.push({
          id: conflictId(type, rec.id, field),
          entity_type: type,
          entity_id: rec.id,
          field,
          created_at: rec.updated_at,
        });
      }
    }
  }
  return {
    entities,
    ops: [...r.log].sort((a, b) => (a.hlc < b.hlc ? -1 : 1)),
    users: [{ id: IDS.user, created_at: new Date(START_MS).toISOString() }],
    devices: [
      {
        id: IDS.deviceA,
        user_id: IDS.user,
        device_name: 'Chrome – “fixture”',
        public_key: null,
        pairing_status: 'self',
        sync_policy: 'ask',
        created_at: new Date(START_MS).toISOString(),
        last_sync_at: null,
      },
    ],
    conflicts,
    settings: { activeResearchId: IDS.research1 },
  };
}

/** Biblioteca com todas as tabelas, um tombstone, um conflito e textos com acentos e aspas. */
function library(): Replica {
  const now = fakeClock();
  const A = new Replica(IDS.deviceA, IDS.user, now);
  const B = new Replica(IDS.deviceB, IDS.user, now);
  seedTrack(A);
  seedTrack(A, IDS.trackB, 'soundcloud:tracks:2');
  seedResearch(A, IDS.research1, 'Pesquisa "Latin" à noite');
  seedResearch(A, IDS.research2, 'Techno\\Industrial');
  seedCategory(A, IDS.categoryX, 'Vocal ✓');
  seedCategory(A, IDS.categoryY, 'Apagar');
  A.put('decision', decisionId(IDS.trackA, IDS.research1), {
    user_id: IDS.user,
    track_id: IDS.trackA,
    research_id: IDS.research1,
    decision: true,
    device_source: IDS.deviceA,
  });
  A.put('decision', decisionId(IDS.trackB, IDS.research1), {
    user_id: IDS.user,
    track_id: IDS.trackB,
    research_id: IDS.research1,
    decision: false,
    device_source: IDS.deviceA,
  });
  A.put('track_category', trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX), {
    track_id: IDS.trackA,
    research_id: IDS.research1,
    category_id: IDS.categoryX,
  });
  const playlist = '40000000-0000-4000-8000-000000000001';
  A.put('playlist', playlist, {
    user_id: IDS.user,
    name: 'Set de sábado',
    description: 'linha 1\nlinha 2\ttab',
    research_id: IDS.research1,
    category_id: null,
    external_playlist_id: null,
  });
  A.put('playlist_track', playlistTrackId(playlist, IDS.trackA), {
    playlist_id: playlist,
    track_id: IDS.trackA,
    position: 'a0',
  });
  A.delete('category', IDS.categoryY);
  syncPair(A, B);
  // edição concorrente: vira conflito visível nos dois aparelhos
  A.put('research', IDS.research2, { name: 'Techno (PC)' });
  B.put('research', IDS.research2, { name: 'Techno (celular)' });
  B.put('track', IDS.trackB, { artwork_url: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg' });
  syncPair(A, B);
  return A;
}

async function rehash(b: Backup): Promise<Backup> {
  const { sha256: _s, ...body } = b;
  return createBackup({
    data: body.data,
    deviceId: body.device_id,
    userId: body.user_id,
    schemaVersion: body.schema_version,
    now: new Date(body.created_at),
  });
}

async function vectors() {
  const valid = await createBackup({
    data: dataOf(library()),
    deviceId: IDS.deviceA,
    userId: IDS.user,
    schemaVersion: CUEPOINT_SCHEMA_VERSION,
    now: new Date(START_MS + 3_600_000),
  });

  const tampered = clone(valid);
  (tampered.data.entities.track[0] as unknown as { title: string }).title = 'Alterado';

  const brokenRef = clone(valid);
  brokenRef.data.entities.track = brokenRef.data.entities.track.filter((t) => t.id !== IDS.trackB);

  const badRecord = clone(valid);
  (badRecord.data.entities.research[0] as unknown as { name: string }).name = '   ';

  const badOps = clone(valid);
  (badOps.data.ops[0] as unknown as { op_id: string }).op_id = IDS.trackA;

  const notOurs = clone(valid) as unknown as Record<string, unknown>;
  notOurs.format = 'outro-app';

  const text = JSON.stringify(valid);
  const invalid: { name: string; text: string; error: string }[] = [];
  const add = async (name: string, input: string) => {
    const error = await parseBackup(input).then(
      () => 'aceito',
      (e: unknown) => (e instanceof BackupError ? e.message : String(e)),
    );
    invalid.push({ name, text: input, error });
  };
  await add('json truncado', text.slice(0, Math.floor(text.length / 2)));
  await add('outro formato', JSON.stringify(notOurs));
  await add('checksum (registro alterado)', JSON.stringify(tampered));
  await add('referência quebrada', JSON.stringify(await rehash(brokenRef)));
  await add('registro inválido', JSON.stringify(await rehash(badRecord)));
  await add('log de operações inválido', JSON.stringify(await rehash(badOps)));
  return { valid, invalid };
}

function restoredRecords(backup: Backup): unknown {
  const fresh = new Replica('ffffffff-0000-4000-8000-00000000000f', backup.user_id);
  fresh.receive(backup.data.ops);
  const records = [...fresh.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.parse(canonicalJson(records as never));
}

function backupRecords(backup: Backup): unknown {
  const all = ENTITY_TYPES.flatMap((t) => backup.data.entities[t]).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return JSON.parse(canonicalJson(all as never));
}

describe('vetores de backup', () => {
  it('spec/vectors/backup.json está atualizado', async () => {
    const { valid, invalid } = await vectors();
    await expect(
      pretty({
        version: 1,
        description:
          '`valid` precisa ser aceito (mesmo sha256 recalculado do JSON canônico); cada item de `invalid` precisa ser recusado com `error`.',
        valid,
        invalid,
      }),
    ).toMatchFileSnapshot(resolve(spec, 'vectors/backup.json'));
  });

  it('o backup válido é aceito e o log reproduz as entidades; os inválidos são recusados', async () => {
    const file = JSON.parse(readFileSync(resolve(spec, 'vectors/backup.json'), 'utf8')) as {
      valid: Backup;
      invalid: { name: string; text: string; error: string }[];
    };
    const ok = await validateBackup(file.valid);
    expect(ok.counts).toMatchObject({
      track: 2,
      research: 2,
      category: 2,
      ops: expect.any(Number),
    });
    expect(ok.data.conflicts).toHaveLength(1);
    expect(restoredRecords(ok)).toEqual(backupRecords(ok));
    for (const c of file.invalid) {
      expect(c.error, c.name).not.toBe('aceito');
      await expect(parseBackup(c.text), c.name).rejects.toThrow(c.error);
    }
  });

  it.runIf(existsSync(resolve(spec, 'vectors/backup-android.json')))(
    'o backup gerado pelo Android é aceito e restaurável',
    async () => {
      const text = readFileSync(resolve(spec, 'vectors/backup-android.json'), 'utf8');
      const backup = await parseBackup(text);
      expect(backup.counts.ops).toBe(backup.data.ops.length);
      expect(restoredRecords(backup)).toEqual(backupRecords(backup));
    },
  );
});
