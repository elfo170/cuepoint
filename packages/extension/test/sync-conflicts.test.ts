import { decisionId, Replica, trackCategoryId, trackIdFromUrn } from '@cuepoint/core';
import { describe, expect, it } from 'vitest';
import { loadConflicts } from '../src/data/conflicts';
import { Curation, type TrackInput } from '../src/data/curation';
import { CuePointDB } from '../src/data/db';
import { categoryDuplicates, loadSnapshot } from '../src/data/queries';
import { Store } from '../src/data/store';

const OTHER = 'bbbbbbbb-0000-4000-8000-00000000000b';
let counter = 0;

/** Este aparelho (Store real no IndexedDB) e outro aparelho (réplica em memória). */
async function setup() {
  const db = new CuePointDB(`sync-${Date.now()}-${counter++}`);
  const store = new Store(db);
  await store.init();
  const curation = new Curation(store);
  const other = new Replica(OTHER, store.userId);
  const fromHere = async () => other.receive(await store.opsSince(other.vv));
  const fromOther = async () => store.receive(other.opsSince(await store.versionVector()));
  return { db, store, curation, other, fromHere, fromOther };
}

const track = (over: Partial<TrackInput> = {}): TrackInput => ({
  title: 'Deep Groove',
  artist: 'Fixture Artist',
  url: 'https://soundcloud.com/fixture-artist/deep-groove',
  urn: 'soundcloud:tracks:123',
  artworkUrl: null,
  source: 'dom',
  ...over,
});

describe('tela de conflitos', () => {
  it('mostra os dois valores lado a lado e a escolha fecha o conflito só naquele campo', async () => {
    const { db, store, curation, other, fromHere, fromOther } = await setup();
    const r = await curation.createResearch('Techno');
    await fromHere();
    other.put('research', r.id, { name: 'Techno Peak' });
    await curation.updateResearch(r.id, { name: 'Techno Groovy' });
    await fromOther();

    const [c, ...rest] = await loadConflicts(db);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({
      kind: 'Pesquisa',
      fieldLabel: 'Nome',
      entityId: r.id,
      field: 'name',
    });
    expect(c!.options.map((o) => o.label).sort()).toEqual(['Techno Groovy', 'Techno Peak']);
    expect(c!.options.filter((o) => o.current)).toHaveLength(1);
    expect(c!.options.flatMap((o) => o.origins)).toContain(OTHER);

    await store.resolve('research', r.id, 'name', 'Techno Peak');
    expect(await loadConflicts(db)).toEqual([]);
    const last = (await db.sync_events.orderBy('hlc').last())!;
    expect(last.operation).toBe('resolve');
    expect(Object.keys(last.fields)).toEqual(['name']);
    expect((await db.researches.get(r.id))?.name).toBe('Techno Peak');
  });

  it('excluir × editar: "Mantida" restaura o registro com a edição do outro aparelho', async () => {
    const { db, store, curation, other, fromHere, fromOther } = await setup();
    const r = await curation.createResearch('Techno');
    await fromHere();
    await curation.deleteResearch(r.id);
    other.put('research', r.id, { description: 'ainda uso' });
    await fromOther();

    const [c] = await loadConflicts(db);
    expect(c?.fieldLabel).toBe('Exclusão');
    expect(c!.options.map((o) => o.label).sort()).toEqual(['Excluída', 'Mantida (não excluída)']);

    await store.resolve('research', r.id, 'deleted_at', null);
    expect(await loadConflicts(db)).toEqual([]);
    const rec = await db.researches.get(r.id);
    expect(rec?.deleted_at).toBeNull();
    expect(rec?.description).toBe('ainda uso');
  });

  it('decisão divergente aparece como Aprovada × Rejeitada, com faixa e pesquisa', async () => {
    const { db, curation, other, fromHere, fromOther } = await setup();
    const r = await curation.createResearch('Latin Bass');
    const t = await curation.ensureTrack(track());
    await curation.decide(t.id, r.id, true);
    await fromHere();
    // cada lado muda sem ver o outro: lá rejeita; aqui rejeita e volta a aprovar
    other.put('decision', decisionId(t.id, r.id), { decision: false, device_source: OTHER });
    await curation.decide(t.id, r.id, false);
    await curation.decide(t.id, r.id, true);
    await fromOther();
    const [c] = await loadConflicts(db);
    expect(c?.kind).toBe('Decisão');
    expect(c?.subject).toContain('Deep Groove');
    expect(c?.subject).toContain('Latin Bass');
    expect(c!.options.map((o) => o.label).sort()).toEqual(['Aprovada', 'Rejeitada']);
  });
});

describe('faixa provisória entre aparelhos', () => {
  it('decisão da provisória diferente da definitiva vira conflito ao associar', async () => {
    const { db, curation } = await setup();
    const r = await curation.createResearch('Peak Time');
    const definitive = await curation.ensureTrack(track());
    await curation.decide(definitive.id, r.id, false);
    const provisional = await curation.ensureTrack(
      track({ urn: null, url: null, title: 'Deep Groove (rip)' }),
    );
    await curation.decide(provisional.id, r.id, true);
    await curation.mergeTracks(provisional.id, definitive.id);
    const conflicts = await loadConflicts(db);
    expect(conflicts.map((c) => [c.entityId, c.field])).toEqual([
      [decisionId(definitive.id, r.id), 'decision'],
    ]);
  });

  it('a definitiva que chega de outro aparelho absorve a provisória daqui', async () => {
    const { db, curation, other, fromHere, fromOther } = await setup();
    const r = await curation.createResearch('Peak Time');
    const provisional = await curation.ensureTrack(track({ urn: null }));
    await curation.decide(provisional.id, r.id, true);
    await fromHere();
    const definitiveId = trackIdFromUrn('soundcloud:tracks:123');
    other.put('track', definitiveId, {
      soundcloud_urn: 'soundcloud:tracks:123',
      soundcloud_url: track().url,
      title: 'Deep Groove',
      artist: 'Fixture Artist',
      artwork_url: null,
      metadata_source: 'android',
      merged_into: null,
    });
    await fromOther();

    expect(await curation.reconcileProvisional()).toBe(1);
    expect((await db.tracks.get(provisional.id))?.merged_into).toBe(definitiveId);
    expect((await curation.decisionState(definitiveId, r.id)).decision).toBe(true);
    expect(await loadConflicts(db)).toEqual([]);
    expect(await curation.reconcileProvisional()).toBe(0); // idempotente
  });

  it('não associa quando duas definitivas casam (ambíguo)', async () => {
    const { curation, other, fromHere, fromOther } = await setup();
    await curation.ensureTrack(track({ urn: null, url: null }));
    await fromHere();
    for (const n of ['1', '2']) {
      other.put('track', trackIdFromUrn(`soundcloud:tracks:${n}`), {
        soundcloud_urn: `soundcloud:tracks:${n}`,
        soundcloud_url: null,
        title: 'Deep Groove',
        artist: 'Fixture Artist',
        artwork_url: null,
        metadata_source: 'android',
        merged_into: null,
      });
    }
    await fromOther();
    expect(await curation.reconcileProvisional()).toBe(0);
  });
});

describe('categorias com o mesmo nome', () => {
  it('sugere juntar e move as classificações para a mais antiga', async () => {
    const { db, curation, other, fromHere, fromOther } = await setup();
    const r = await curation.createResearch('Latin Bass');
    const t1 = await curation.ensureTrack(track());
    const t2 = await curation.ensureTrack(
      track({ urn: 'soundcloud:tracks:456', url: null, title: 'Outra' }),
    );
    const mine = await curation.createCategory('Vocal');
    await curation.decide(t1.id, r.id, true);
    await curation.setTrackCategory(t1.id, r.id, mine.id, true);
    await fromHere();
    const theirs = '30000000-0000-4000-8000-0000000000ff';
    other.put('category', theirs, { user_id: other.userId, name: ' vocal', description: '' });
    other.put('decision', decisionId(t2.id, r.id), {
      user_id: other.userId,
      track_id: t2.id,
      research_id: r.id,
      decision: true,
      device_source: OTHER,
    });
    other.put('track_category', trackCategoryId(t2.id, r.id, theirs), {
      track_id: t2.id,
      research_id: r.id,
      category_id: theirs,
    });
    await fromOther();

    const groups = categoryDuplicates((await loadSnapshot(db)).categories);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([[mine.id, theirs]]);

    await curation.mergeCategories(mine.id, [theirs]);
    expect((await curation.listCategories()).map((c) => c.id)).toEqual([mine.id]);
    expect((await curation.decisionState(t2.id, r.id)).categoryIds).toEqual([mine.id]);
    expect((await curation.decisionState(t1.id, r.id)).categoryIds).toEqual([mine.id]);
    expect(categoryDuplicates((await loadSnapshot(db)).categories)).toEqual([]);
  });
});
