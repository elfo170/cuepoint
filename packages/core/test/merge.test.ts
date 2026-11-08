import { describe, expect, it } from 'vitest';
import { canonicalJson, decisionId, Replica, trackCategoryId, type Op } from '../src';
import { SCENARIOS } from './merge-scenarios';
import { IDS, runScenario, type ScenarioResult } from './scenarios';

function find(name: string): ScenarioResult & { world: ReturnType<typeof runScenario>['world'] } {
  const s = SCENARIOS.find((x) => x.name === name);
  if (!s) throw new Error(name);
  return runScenario(s);
}

describe('cenários de mesclagem (PRD §5.6)', () => {
  it('todas as réplicas convergem em todos os cenários', () => {
    for (const s of SCENARIOS) {
      const { world } = runScenario(s);
      const dump = (r: Replica) => canonicalJson([...r.records.entries()].sort() as never);
      expect(dump(world.B), s.name).toBe(dump(world.A));
      expect(dump(world.C), s.name).toBe(dump(world.A));
    }
  });

  it('decisões em pesquisas diferentes não conflitam', () => {
    const r = find('decisoes-independentes-por-pesquisa');
    expect(r.conflicts).toEqual([]);
    const a = r.world.A;
    expect(a.get('decision', decisionId(IDS.trackA, IDS.research1))?.decision).toBe(true);
    expect(a.get('decision', decisionId(IDS.trackA, IDS.research2))?.decision).toBe(false);
  });

  it('categorias diferentes são preservadas', () => {
    const r = find('categorias-diferentes-preservadas');
    expect(r.conflicts).toEqual([]);
    expect(
      r.world.A.all('track_category')
        .map((t) => t.category_id)
        .sort(),
    ).toEqual([IDS.categoryX, IDS.categoryY].sort());
  });

  it('a mesma classificação vira um único registro', () => {
    const r = find('mesma-categoria-nos-dois-aparelhos');
    expect(r.conflicts).toEqual([]);
    expect(r.world.A.all('track_category')).toHaveLength(1);
    expect(
      r.world.A.get('track_category', trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX)),
    ).toBeDefined();
  });

  it('campos independentes são mesclados', () => {
    const r = find('campos-independentes-mesclados');
    expect(r.conflicts).toEqual([]);
    expect(r.world.A.get('research', IDS.research1)).toMatchObject({
      name: 'Techno Groovy',
      description: 'Groove e percussão',
    });
  });

  it('mesmo campo com valores diferentes vira conflito com os dois candidatos', () => {
    const r = find('mesmo-campo-conflito');
    expect(r.conflicts).toEqual([
      { entity_type: 'research', entity_id: IDS.research1, field: 'name' },
    ]);
    const rec = r.world.A.get('research', IDS.research1)!;
    expect(rec._c?.name?.map((c) => c.value).sort()).toEqual(['Techno Groovy', 'Techno Peak']);
    // vencedor provisório determinístico: maior HLC (B escreveu depois)
    expect(rec.name).toBe('Techno Peak');
  });

  it('mesmo valor não é conflito', () => {
    expect(find('mesmo-valor-sem-conflito').conflicts).toEqual([]);
  });

  it('decisões divergentes na mesma pesquisa conflitam; iguais não', () => {
    expect(find('decisao-divergente-conflito').conflicts.map((c) => c.field)).toEqual(['decision']);
    expect(find('decisao-igual-sem-conflito').conflicts).toEqual([]);
  });

  it('exclusões são propagadas e não conflitam entre si', () => {
    const r = find('exclusao-propagada');
    expect(r.world.B.get('category', IDS.categoryX)?.deleted_at).not.toBeNull();
    expect(find('exclusoes-concorrentes').conflicts).toEqual([]);
  });

  it('excluir × editar vira conflito em deleted_at', () => {
    const r = find('exclusao-vs-edicao-conflito');
    expect(r.conflicts.map((c) => c.field)).toEqual(['deleted_at']);
    expect(r.world.A.get('research', IDS.research1)?.description).toBe('ainda uso');
  });

  it('resolução fecha o conflito em todas as réplicas', () => {
    const r = find('resolucao-de-conflito');
    expect(r.conflicts).toEqual([]);
    expect(r.world.B.conflicts()).toEqual([]);
    expect(r.world.B.get('research', IDS.research1)?.name).toBe('Techno Peak');
  });

  it('alterações são retransmitidas A→B→C', () => {
    const r = find('retransmissao-a-b-c');
    expect(r.world.A.get('research', IDS.research1)?.description).toBe('editado em C');
  });
});

describe('idempotência e causalidade', () => {
  it('reentrega não altera o estado nem duplica o log', () => {
    const r = find('mesmo-campo-conflito');
    const before = JSON.stringify([...r.world.A.records]);
    const logSize = r.world.A.log.length;
    expect(r.world.A.receive(r.world.B.log)).toBe(0);
    expect(JSON.stringify([...r.world.A.records])).toBe(before);
    expect(r.world.A.log).toHaveLength(logSize);
  });

  it('recusa lacunas na sequência de uma origem', () => {
    const a = new Replica(IDS.deviceA, IDS.user);
    const b = new Replica(IDS.deviceB, IDS.user);
    a.put('category', IDS.categoryX, { user_id: IDS.user, name: 'X', description: '' });
    const second: Op = a.put('category', IDS.categoryX, { name: 'Y' });
    expect(() => b.receive([second])).toThrow(/lacuna/);
  });

  it('valida as regras de integridade em escritas locais', () => {
    const a = new Replica(IDS.deviceA, IDS.user);
    expect(() =>
      a.put('decision', decisionId(IDS.trackA, IDS.research1), {
        user_id: IDS.user,
        track_id: IDS.trackA,
        research_id: IDS.research1,
        decision: 'sim' as unknown as boolean,
        device_source: IDS.deviceA,
      }),
    ).toThrow();
    expect(() =>
      a.put('research', IDS.research1, {
        user_id: IDS.user,
        name: '   ',
        description: '',
        archived: false,
      }),
    ).toThrow();
  });
});

describe('isNoopWrite', () => {
  it('detecta escritas sem efeito, exceto em campos em conflito', async () => {
    const { isNoopWrite } = await import('../src');
    const r = find('mesmo-campo-conflito').world.A.get('research', IDS.research1)!;
    expect(isNoopWrite(undefined, { name: 'x' })).toBe(false);
    expect(isNoopWrite(r, { description: '', deleted_at: null })).toBe(true);
    expect(isNoopWrite(r, { description: 'nova' })).toBe(false);
    expect(isNoopWrite(r, { name: r.name })).toBe(false); // em conflito
    expect(
      isNoopWrite(
        { ...r, deleted_at: '2026-01-01T00:00:00.000Z' },
        { deleted_at: '2026-02-02T00:00:00.000Z' },
      ),
    ).toBe(true);
  });
});
