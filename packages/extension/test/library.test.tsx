import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Curation, type TrackInput } from '../src/data/curation';
import { CuePointDB } from '../src/data/db';
import {
  allTracks,
  categoryUsage,
  loadSnapshot,
  researchTracks,
  summarizeResearches,
} from '../src/data/queries';
import { Store } from '../src/data/store';
import { ConfirmButton, DecisionButtons } from '../src/library/components';

afterEach(cleanup);

let n = 0;
async function library() {
  const db = new CuePointDB(`lib-${Date.now()}-${n++}`);
  const curation = new Curation(new Store(db));
  const latin = await curation.createResearch('Latin Bass');
  const techno = await curation.createResearch('Techno Groovy');
  const vocal = await curation.createCategory('Vocal');
  const groovy = await curation.createCategory('Groovy');
  const mk = (i: number): TrackInput => ({
    title: `Faixa ${i}`,
    artist: i % 2 ? 'Artista Ímpar' : 'Artista Par',
    url: `https://soundcloud.com/a/faixa-${i}`,
    urn: `soundcloud:tracks:${i}`,
    artworkUrl: null,
    source: 'dom',
  });
  const [a, b, c] = await Promise.all([1, 2, 3].map((i) => curation.ensureTrack(mk(i))));
  // Faixa A: aprovada em Latin (Vocal+Groovy), rejeitada em Techno
  await curation.decide(a!.id, latin.id, true);
  await curation.setTrackCategory(a!.id, latin.id, vocal.id, true);
  await curation.setTrackCategory(a!.id, latin.id, groovy.id, true);
  await curation.decide(a!.id, techno.id, false);
  // Faixa B: aprovada em Latin sem categoria (pendente)
  await curation.decide(b!.id, latin.id, true);
  // Faixa C: rejeitada em Latin
  await curation.decide(c!.id, latin.id, false);
  return { db, curation, latin, techno, vocal, groovy, a: a!, b: b!, c: c! };
}

describe('consultas da biblioteca', () => {
  it('resume aprovadas, rejeitadas e pendentes por pesquisa', async () => {
    const { db } = await library();
    const s = summarizeResearches(await loadSnapshot(db));
    expect(s.map((x) => [x.research.name, x.approved, x.rejected, x.pending])).toEqual([
      ['Latin Bass', 2, 1, 1],
      ['Techno Groovy', 0, 1, 0],
    ]);
  });

  it('lista por aba, filtra por categoria e busca', async () => {
    const { db, latin, vocal, groovy, a, b, c } = await library();
    const snap = await loadSnapshot(db);
    const ids = (rows: { track: { id: string } }[]) => rows.map((r) => r.track.id).sort();
    expect(ids(researchTracks(snap, latin.id, 'approved'))).toEqual([a.id, b.id].sort());
    expect(ids(researchTracks(snap, latin.id, 'rejected'))).toEqual([c.id]);
    expect(ids(researchTracks(snap, latin.id, 'pending'))).toEqual([b.id]);
    expect(ids(researchTracks(snap, latin.id, 'approved', [vocal.id, groovy.id]))).toEqual([a.id]);
    expect(ids(researchTracks(snap, latin.id, 'approved', [], 'faixa 2'))).toEqual([b.id]);
    expect(ids(researchTracks(snap, latin.id, 'approved', [], 'ímpar'))).toEqual([a.id]);
  });

  it('visão global mostra a decisão de cada pesquisa', async () => {
    const { db, latin, techno, a } = await library();
    const rows = allTracks(await loadSnapshot(db));
    expect(rows.find((r) => r.track.id === a.id)?.decisions).toEqual({
      [latin.id]: true,
      [techno.id]: false,
    });
  });

  it('excluir categoria remove as classificações e some dos filtros', async () => {
    const { db, curation, latin, vocal, a } = await library();
    await curation.deleteCategory(vocal.id);
    const snap = await loadSnapshot(db);
    expect(categoryUsage(snap).map((u) => u.category.name)).toEqual(['Groovy']);
    expect(
      researchTracks(snap, latin.id, 'approved').find((r) => r.track.id === a.id)?.categoryIds,
    ).not.toContain(vocal.id);
  });

  it('pesquisa arquivada continua com seus dados; excluída some', async () => {
    const { db, curation, techno } = await library();
    await curation.updateResearch(techno.id, { archived: true });
    expect((await curation.listResearches()).map((r) => r.name)).toEqual(['Latin Bass']);
    expect((await curation.listResearches(true)).map((r) => r.name)).toHaveLength(2);
    await curation.deleteResearch(techno.id);
    expect(summarizeResearches(await loadSnapshot(db))).toHaveLength(1);
  });
});

describe('componentes', () => {
  it('DecisionButtons alterna e desfaz a decisão', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DecisionButtons value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<DecisionButtons value={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('ConfirmButton só executa após confirmação', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Excluir" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
