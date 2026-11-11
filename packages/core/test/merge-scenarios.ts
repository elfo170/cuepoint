import { decisionId, trackCategoryId } from '../src';
import { decide, IDS, seedCategory, seedResearch, seedTrack, type Scenario } from './scenarios';

const d1 = decisionId(IDS.trackA, IDS.research1);
const d2 = decisionId(IDS.trackA, IDS.research2);

/** Cenários do PRD §5.6, §5.7 e §7.2 — viram vetores em spec/vectors/merge.json. */
export const SCENARIOS: Scenario[] = [
  {
    name: 'decisoes-independentes-por-pesquisa',
    description:
      'PRD §7.2: a mesma faixa aprovada numa pesquisa e rejeitada noutra não é conflito.',
    run: ({ A, B, sync }) => {
      seedTrack(A);
      seedResearch(A, IDS.research1, 'Latin Bass');
      seedResearch(A, IDS.research2, 'Techno Groovy');
      sync(A, B);
      decide(A, IDS.trackA, IDS.research1, true, d1);
      decide(B, IDS.trackA, IDS.research2, false, d2);
    },
  },
  {
    name: 'categorias-diferentes-preservadas',
    description:
      'PRD §5.6: categorias diferentes adicionadas em aparelhos distintos são preservadas.',
    run: ({ A, B, sync }) => {
      seedTrack(A);
      seedResearch(A, IDS.research1, 'Peak Time');
      seedCategory(A, IDS.categoryX, 'Vocal');
      seedCategory(A, IDS.categoryY, 'Groovy');
      decide(A, IDS.trackA, IDS.research1, true, d1);
      sync(A, B);
      A.put('track_category', trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX), {
        track_id: IDS.trackA,
        research_id: IDS.research1,
        category_id: IDS.categoryX,
      });
      B.put('track_category', trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryY), {
        track_id: IDS.trackA,
        research_id: IDS.research1,
        category_id: IDS.categoryY,
      });
    },
  },
  {
    name: 'mesma-categoria-nos-dois-aparelhos',
    description:
      'Id determinístico: a mesma classificação criada nos dois lados vira um só registro.',
    run: ({ A, B, sync }) => {
      seedTrack(A);
      seedResearch(A, IDS.research1, 'Peak Time');
      seedCategory(A, IDS.categoryX, 'Vocal');
      sync(A, B);
      const id = trackCategoryId(IDS.trackA, IDS.research1, IDS.categoryX);
      const data = { track_id: IDS.trackA, research_id: IDS.research1, category_id: IDS.categoryX };
      A.put('track_category', id, data);
      B.put('track_category', id, data);
    },
  },
  {
    name: 'campos-independentes-mesclados',
    description: 'PRD §5.6: alterações em campos diferentes do mesmo registro são mescladas.',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.put('research', IDS.research1, { name: 'Techno Groovy' });
      B.put('research', IDS.research1, { description: 'Groove e percussão' });
    },
  },
  {
    name: 'mesmo-campo-conflito',
    description: 'PRD §5.6: valores diferentes no mesmo campo geram conflito para o usuário.',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.put('research', IDS.research1, { name: 'Techno Groovy' });
      B.put('research', IDS.research1, { name: 'Techno Peak' });
    },
  },
  {
    name: 'mesmo-valor-sem-conflito',
    description: 'O mesmo valor escrito nos dois aparelhos não é conflito.',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.put('research', IDS.research1, { name: 'Techno Groovy' });
      B.put('research', IDS.research1, { name: 'Techno Groovy' });
    },
  },
  {
    name: 'decisao-divergente-conflito',
    description:
      'Aprovação e rejeição concorrentes da mesma faixa na mesma pesquisa geram conflito.',
    run: ({ A, B, sync }) => {
      seedTrack(A);
      seedResearch(A, IDS.research1, 'Latin Bass');
      sync(A, B);
      decide(A, IDS.trackA, IDS.research1, true, d1);
      decide(B, IDS.trackA, IDS.research1, false, d1);
    },
  },
  {
    name: 'decisao-igual-sem-conflito',
    description: 'A mesma decisão nos dois aparelhos (device_source diferente) não é conflito.',
    run: ({ A, B, sync }) => {
      seedTrack(A);
      seedResearch(A, IDS.research1, 'Latin Bass');
      sync(A, B);
      decide(A, IDS.trackA, IDS.research1, true, d1);
      decide(B, IDS.trackA, IDS.research1, true, d1);
    },
  },
  {
    name: 'exclusao-propagada',
    description: 'PRD §5.7: exclusão explícita é propagada como tombstone.',
    run: ({ A, B, sync }) => {
      seedCategory(A, IDS.categoryX, 'Vocal');
      sync(A, B);
      A.delete('category', IDS.categoryX);
    },
  },
  {
    name: 'exclusoes-concorrentes',
    description: 'Duas exclusões concorrentes do mesmo registro não são conflito.',
    run: ({ A, B, sync }) => {
      seedCategory(A, IDS.categoryX, 'Vocal');
      sync(A, B);
      A.delete('category', IDS.categoryX);
      B.delete('category', IDS.categoryX);
    },
  },
  {
    name: 'exclusao-vs-edicao-conflito',
    description:
      'Excluir num aparelho e editar no outro gera conflito (nada é descartado em silêncio).',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.delete('research', IDS.research1);
      B.put('research', IDS.research1, { description: 'ainda uso' });
    },
  },
  {
    name: 'resolucao-de-conflito',
    description: 'A resolução é uma nova operação que domina as versões em conflito.',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.put('research', IDS.research1, { name: 'Techno Groovy' });
      B.put('research', IDS.research1, { name: 'Techno Peak' });
      sync(A, B);
      A.resolve('research', IDS.research1, 'name', 'Techno Peak');
    },
  },
  {
    name: 'retransmissao-a-b-c',
    description: 'Alterações chegam a C via B, mesmo sem contato direto entre A e C.',
    run: ({ A, B, C, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      sync(B, C);
      C.put('research', IDS.research1, { description: 'editado em C' });
      sync(B, C);
    },
  },
  {
    name: 'resolucao-de-exclusao',
    description:
      'Excluir × editar resolvido com "restaurar": a resolução grava só deleted_at e o registro volta com a edição.',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.delete('research', IDS.research1);
      B.put('research', IDS.research1, { description: 'ainda uso' });
      sync(A, B);
      B.resolve('research', IDS.research1, 'deleted_at', null);
    },
  },
  {
    name: 'resolucao-nao-decide-exclusao',
    description:
      'Resolver um campo (nome) não ressuscita o registro nem fecha, por tabela, o conflito de exclusão.',
    run: ({ A, B, sync }) => {
      seedResearch(A, IDS.research1, 'Techno');
      sync(A, B);
      A.put('research', IDS.research1, { name: 'Techno Groovy' });
      A.delete('research', IDS.research1);
      B.put('research', IDS.research1, { name: 'Techno Peak' });
      sync(A, B);
      A.resolve('research', IDS.research1, 'name', 'Techno Peak');
    },
  },
  {
    name: 'escrita-concorrente-diverge',
    description:
      'Escrita local marcada como concorrente (dados de uma faixa provisória reapontados para a definitiva): valor divergente vira conflito; valor igual, não.',
    run: ({ A, B, sync }) => {
      seedTrack(A);
      seedResearch(A, IDS.research1, 'Latin Bass');
      seedResearch(A, IDS.research2, 'Techno Groovy');
      decide(A, IDS.trackA, IDS.research1, true, d1);
      decide(A, IDS.trackA, IDS.research2, true, d2);
      sync(A, B);
      B.put(
        'decision',
        d1,
        {
          user_id: IDS.user,
          track_id: IDS.trackA,
          research_id: IDS.research1,
          decision: false,
          device_source: B.deviceId,
        },
        undefined,
        { concurrent: true },
      );
      B.put(
        'decision',
        d2,
        {
          user_id: IDS.user,
          track_id: IDS.trackA,
          research_id: IDS.research2,
          decision: true,
          device_source: B.deviceId,
        },
        undefined,
        { concurrent: true },
      );
    },
  },
];
