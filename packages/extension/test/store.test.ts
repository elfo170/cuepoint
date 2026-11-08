import { decisionId, Replica, trackIdFromUrn } from '@cuepoint/core';
import { describe, expect, it } from 'vitest';
import { BackgroundHandler } from '../src/background/handler';
import { Curation, type TrackInput } from '../src/data/curation';
import { CuePointDB } from '../src/data/db';
import { Store } from '../src/data/store';

let counter = 0;
function setup() {
  const db = new CuePointDB(`test-${Date.now()}-${counter++}`);
  const store = new Store(db);
  return { db, store, curation: new Curation(store) };
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

describe('Store', () => {
  it('cria identidade (usuário + dispositivo) uma única vez', async () => {
    const { db, store } = setup();
    const a = await store.init();
    const again = await new Store(db).init();
    expect(again.device.id).toBe(a.device.id);
    expect(a.device.pairing_status).toBe('self');
    expect(a.device.device_name).toMatch(/Chrome/);
  });

  it('grava registro e operação na mesma transação, com seq sem lacunas', async () => {
    const { db, curation } = setup();
    const r = await curation.createResearch('Latin Bass');
    await curation.updateResearch(r.id, { description: 'graves' });
    const events = await db.sync_events.orderBy('[origin+seq]').toArray();
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.every((e) => e.synchronization_status === 'local_pending')).toBe(true);
    expect(events[0]).toMatchObject({ entity_type: 'research', operation: 'create' });
    expect((await db.researches.get(r.id))?.description).toBe('graves');
  });

  it('desfaz a transação inteira quando uma escrita é inválida', async () => {
    const { db, store, curation } = setup();
    const r = await curation.createResearch('Peak Time');
    await expect(
      store.write(async (tx) => {
        await tx.put('research', r.id, { name: 'Novo nome' });
        await tx.put('research', r.id, { name: '   ' });
      }),
    ).rejects.toThrow();
    expect((await db.researches.get(r.id))?.name).toBe('Peak Time');
    expect(await db.sync_events.count()).toBe(1);
  });

  it('troca operações com outra réplica sem duplicar (idempotente)', async () => {
    const { store, curation } = setup();
    await store.init();
    const research = await curation.createResearch('Techno');
    const ops = await store.opsSince({});
    const other = new Replica('bbbbbbbb-0000-4000-8000-00000000000b', store.userId);
    other.receive(ops);
    other.put('research', research.id, { name: 'Techno Groovy' });
    expect(await store.receive(other.opsSince(await store.versionVector()))).toBe(1);
    expect(await store.receive(other.log)).toBe(0);
    expect((await store.get('research', research.id))?.name).toBe('Techno Groovy');
  });

  it('registra e fecha conflitos na tabela conflicts', async () => {
    const { db, store, curation } = setup();
    await store.init();
    const research = await curation.createResearch('Techno');
    const other = new Replica('bbbbbbbb-0000-4000-8000-00000000000b', store.userId);
    other.receive(await store.opsSince({}));
    other.put('research', research.id, { name: 'B' });
    await curation.updateResearch(research.id, { name: 'A' });
    await store.receive(other.opsSince(await store.versionVector()));
    expect(await db.conflicts.toArray()).toMatchObject([{ entity_id: research.id, field: 'name' }]);
    await store.resolve('research', research.id, 'name', 'A');
    expect(await db.conflicts.count()).toBe(0);
  });
});

describe('Curation', () => {
  it('a mesma faixa tem decisões independentes por pesquisa (PRD §7.2)', async () => {
    const { curation } = setup();
    const r1 = await curation.createResearch('Latin Bass');
    const r2 = await curation.createResearch('Techno Groovy');
    const t = await curation.ensureTrack(track());
    await curation.decide(t.id, r1.id, true);
    await curation.decide(t.id, r2.id, false);
    expect((await curation.decisionState(t.id, r1.id)).decision).toBe(true);
    expect((await curation.decisionState(t.id, r2.id)).decision).toBe(false);
  });

  it('URN gera id determinístico e não duplica a faixa', async () => {
    const { db, curation } = setup();
    const a = await curation.ensureTrack(track());
    const b = await curation.ensureTrack(track({ title: 'Deep Groove (Original Mix)' }));
    expect(a.id).toBe(trackIdFromUrn('soundcloud:tracks:123'));
    expect(b.id).toBe(a.id);
    expect(await db.tracks.count()).toBe(1);
    expect((await db.tracks.get(a.id))?.title).toBe('Deep Groove (Original Mix)');
  });

  it('aprovação aceita várias categorias ou nenhuma', async () => {
    const { curation } = setup();
    const r = await curation.createResearch('Peak Time');
    const t = await curation.ensureTrack(track());
    await curation.decide(t.id, r.id, true);
    expect(await curation.decisionState(t.id, r.id)).toEqual({ decision: true, categoryIds: [] });
    const vocal = await curation.createCategory('Vocal');
    const groovy = await curation.createCategory('Groovy');
    await curation.setTrackCategory(t.id, r.id, vocal.id, true);
    await curation.setTrackCategory(t.id, r.id, groovy.id, true);
    expect((await curation.decisionState(t.id, r.id)).categoryIds.sort()).toEqual(
      [vocal.id, groovy.id].sort(),
    );
    await curation.setTrackCategory(t.id, r.id, vocal.id, false);
    expect((await curation.decisionState(t.id, r.id)).categoryIds).toEqual([groovy.id]);
  });

  it('categorias são globais e não duplicam pelo nome', async () => {
    const { curation } = setup();
    const a = await curation.createCategory('Vocal');
    const b = await curation.createCategory('  vocal ');
    expect(b.id).toBe(a.id);
    expect(await curation.listCategories()).toHaveLength(1);
  });

  it('faixa sem URN é provisória e é associada à definitiva quando o URN aparece', async () => {
    const { db, curation } = setup();
    const r = await curation.createResearch('Peak Time');
    const cat = await curation.createCategory('Vocal');
    const provisional = await curation.ensureTrack(track({ urn: null }));
    expect(provisional.soundcloud_urn).toBeNull();
    await curation.decide(provisional.id, r.id, true);
    await curation.setTrackCategory(provisional.id, r.id, cat.id, true);

    const state = await curation.getTrackState(track(), r.id);
    const definitive = trackIdFromUrn('soundcloud:tracks:123');
    expect(state).toEqual({
      trackId: definitive,
      provisional: false,
      decision: true,
      categoryIds: [cat.id],
    });
    expect((await db.tracks.get(provisional.id))?.merged_into).toBe(definitive);
    expect((await db.decisions.get(decisionId(provisional.id, r.id)))?.deleted_at).not.toBeNull();
  });

  it('sem URL nem URN, só reaproveita provisória com título e artista idênticos', async () => {
    const { curation } = setup();
    const a = await curation.ensureTrack(track({ urn: null, url: null }));
    const b = await curation.ensureTrack(track({ urn: null, url: null }));
    const c = await curation.ensureTrack(track({ urn: null, url: null, title: 'Deep Groove ' }));
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });

  it('rejeição não remove a faixa da biblioteca (PRD §6.2)', async () => {
    const { db, curation } = setup();
    const r = await curation.createResearch('Peak Time');
    const t = await curation.ensureTrack(track());
    await curation.decide(t.id, r.id, false);
    expect((await db.tracks.get(t.id))?.deleted_at).toBeNull();
  });
});

describe('BackgroundHandler', () => {
  it('exige pesquisa ativa para decidir e devolve o estado atualizado', async () => {
    const { curation } = setup();
    const handler = new BackgroundHandler(curation);
    await expect(
      handler.handle({ type: 'widget:decide', track: track(), value: true }),
    ).rejects.toThrow(/pesquisa/);
    await handler.handle({ type: 'widget:createResearch', name: 'Latin Bass' });
    const state = (await handler.handle({
      type: 'widget:decide',
      track: track(),
      value: true,
    })) as {
      track: { decision: boolean };
      researches: unknown[];
    };
    expect(state.track.decision).toBe(true);
    expect(state.researches).toHaveLength(1);
  });

  it('criar categoria pelo widget já classifica a faixa atual', async () => {
    const { curation } = setup();
    const handler = new BackgroundHandler(curation);
    await handler.handle({ type: 'widget:createResearch', name: 'Latin Bass' });
    await handler.handle({ type: 'widget:decide', track: track(), value: true });
    const state = (await handler.handle({
      type: 'widget:createCategory',
      track: track(),
      name: 'Vocal',
    })) as { categories: { id: string }[]; track: { categoryIds: string[] } };
    expect(state.track.categoryIds).toEqual([state.categories[0]!.id]);
  });
});
