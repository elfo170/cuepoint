import { ENTITY_TYPES, parseBackup } from '@cuepoint/core';
import { describe, expect, it } from 'vitest';
import { BackupService } from '../src/background/backup-service';
import {
  buildBackup,
  getBackupSettings,
  restoreBackup,
  type BackupRecord,
} from '../src/data/backup';
import { Curation, type TrackInput } from '../src/data/curation';
import { CuePointDB } from '../src/data/db';
import { exportPlaylist, Playlists } from '../src/data/playlists';
import { Store } from '../src/data/store';

let n = 0;
function setup() {
  const db = new CuePointDB(`pb-${Date.now()}-${n++}`);
  const store = new Store(db);
  return { db, store, curation: new Curation(store), playlists: new Playlists(store) };
}

const input = (i: number, over: Partial<TrackInput> = {}): TrackInput => ({
  title: `Faixa ${i}`,
  artist: `Artista ${i}`,
  url: `https://soundcloud.com/a/faixa-${i}`,
  urn: `soundcloud:tracks:${i}`,
  artworkUrl: null,
  source: 'dom',
  ...over,
});

async function seeded() {
  const ctx = setup();
  const { curation } = ctx;
  const latin = await curation.createResearch('Latin Bass', 'graves');
  const techno = await curation.createResearch('Techno');
  const vocal = await curation.createCategory('Vocal');
  const t = [];
  for (let i = 1; i <= 4; i++) t.push(await curation.ensureTrack(input(i)));
  await curation.decide(t[0]!.id, latin.id, true);
  await curation.decide(t[1]!.id, latin.id, true);
  await curation.decide(t[2]!.id, latin.id, false);
  await curation.decide(t[3]!.id, techno.id, true);
  await curation.setTrackCategory(t[1]!.id, latin.id, vocal.id, true);
  await curation.setTrackCategory(t[3]!.id, techno.id, vocal.id, true);
  return { ...ctx, latin, techno, vocal, t };
}

describe('playlists', () => {
  it('cria a partir de pesquisa, categoria ou ambos', async () => {
    const { playlists, latin, vocal, t } = await seeded();
    const ids = async (p: { id: string }) => (await playlists.items(p.id)).map((i) => i.track.id);
    const byResearch = await playlists.create({ name: 'Latin', researchId: latin.id });
    expect(await ids(byResearch)).toEqual([t[0]!.id, t[1]!.id]);
    const byCategory = await playlists.create({ name: 'Vocal', categoryId: vocal.id });
    expect((await ids(byCategory)).sort()).toEqual([t[1]!.id, t[3]!.id].sort());
    const both = await playlists.create({
      name: 'Latin Vocal',
      researchId: latin.id,
      categoryId: vocal.id,
    });
    expect(await ids(both)).toEqual([t[1]!.id]);
    expect(await ids(await playlists.create({ name: 'Manual' }))).toEqual([]);
  });

  it('adiciona, reordena, remove e atualiza a partir da origem', async () => {
    const { playlists, curation, latin, t } = await seeded();
    const p = await playlists.create({ name: 'Latin', researchId: latin.id });
    expect(await playlists.addTrack(p.id, t[3]!.id)).toBe(true);
    expect(await playlists.addTrack(p.id, t[3]!.id)).toBe(false);
    await playlists.move(p.id, (await playlists.items(p.id))[2]!.item.id, 0);
    expect((await playlists.items(p.id)).map((i) => i.track.id)).toEqual([
      t[3]!.id,
      t[0]!.id,
      t[1]!.id,
    ]);
    await playlists.removeItem((await playlists.items(p.id))[1]!.item.id);
    expect((await playlists.items(p.id)).map((i) => i.track.id)).toEqual([t[3]!.id, t[1]!.id]);

    await curation.decide(t[2]!.id, latin.id, true); // nova aprovada na origem
    expect(await playlists.refreshFromSource(p.id)).toBe(2); // t2 nova + t0 removida volta
    expect((await playlists.items(p.id)).map((i) => i.track.id)).toContain(t[2]!.id);
  });

  it('exporta URLs, CSV e JSON', async () => {
    const { playlists, latin } = await seeded();
    const p = await playlists.create({ name: 'Latin: "best"', researchId: latin.id });
    const items = await playlists.items(p.id);
    expect(exportPlaylist(p, items, 'urls').content).toBe(
      'https://soundcloud.com/a/faixa-1\nhttps://soundcloud.com/a/faixa-2\n',
    );
    const csv = exportPlaylist(p, items, 'csv');
    expect(csv.filename).toBe('Latin best.csv');
    expect(csv.content.split('\n')[1]).toBe(
      '1,Faixa 1,Artista 1,https://soundcloud.com/a/faixa-1,soundcloud:tracks:1',
    );
    expect(JSON.parse(exportPlaylist(p, items, 'json').content).tracks).toHaveLength(2);
  });
});

describe('backup', () => {
  it('restaura a biblioteca completa com todos os relacionamentos (PRD §17.5)', async () => {
    const src = await seeded();
    await src.playlists.create({ name: 'Latin', researchId: src.latin.id });
    await src.curation.setActiveResearchId(src.latin.id);
    const backup = await parseBackup(JSON.stringify(await buildBackup(src.store)));

    const dst = setup();
    await dst.curation.createResearch('Será substituída');
    await restoreBackup(dst.store, backup);

    for (const type of ENTITY_TYPES) {
      const a = await src.db.entityTable(type).toArray();
      const b = await dst.db.entityTable(type).toArray();
      expect(b, type).toEqual(a);
    }
    expect(await dst.db.sync_events.count()).toBe(await src.db.sync_events.count());
    expect(await dst.curation.getActiveResearchId()).toBe(src.latin.id);
    expect((await dst.store.init()).device.id).toBe((await src.store.init()).device.id);

    // continua escrevendo sem lacunas na sequência do aparelho
    await dst.curation.createResearch('Depois do restore');
    const seqs = (await dst.db.sync_events.toArray())
      .filter((e) => e.origin === dst.store.deviceId)
      .map((e) => e.seq)
      .sort((x, y) => x - y);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    const playlist = (await dst.playlists.list())[0]!;
    expect((await dst.playlists.items(playlist.id)).map((i) => i.track.title)).toEqual([
      'Faixa 1',
      'Faixa 2',
    ]);
  });

  it('BackupService grava arquivo, registra histórico e só repete quando há alterações', async () => {
    const { store, curation } = await seeded();
    const files: { name: string; content: string }[] = [];
    const service = new BackupService(store, async (name, content) => {
      files.push({ name, content });
    });
    const first = (await service.run('auto')) as BackupRecord;
    expect(first.filename).toMatch(/^CuePoint\/backups\/cuepoint-backup-\d{8}-\d{6}\.json$/);
    expect(await service.run('auto')).toBeNull(); // nada mudou
    await curation.createResearch('Nova');
    expect(await service.run('auto')).not.toBeNull();
    expect(files).toHaveLength(2);
    expect((await parseBackup(files[1]!.content)).counts.research).toBe(3);
    expect(((await store.getMeta<BackupRecord[]>('backup.history')) ?? []).length).toBe(2);
  });

  it('dispara o backup ao atingir N alterações', async () => {
    const { store, curation } = setup();
    await store.setMeta('backup.settings', {
      ...(await getBackupSettings(store)),
      everyChanges: 3,
    });
    const written: string[] = [];
    const service = new BackupService(store, async (name) => void written.push(name));
    await curation.createResearch('1');
    await service.onChanges();
    expect(written).toHaveLength(0);
    await curation.createResearch('2');
    await curation.createResearch('3');
    await service.onChanges();
    expect(written).toHaveLength(1);
  });
});
