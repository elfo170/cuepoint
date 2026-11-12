/**
 * Isolamento por usuário (Sprint 15): operações e pareamento de outro usuário são recusados.
 * Gera spec/vectors/isolation.json, lido também pela suíte Kotlin.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSameUser,
  ForeignUserError,
  isSameUser,
  pairingUserDecision,
  Replica,
  validateOp,
  type Op,
  type PairingUserDecision,
} from '../src';
import { fakeClock, IDS } from './scenarios';

const spec = resolve(__dirname, '../../../spec/vectors/isolation.json');
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const OTHER_USER = '00000000-0000-4000-8000-000000000002';

function opsOf(user: string): Op[] {
  const r = new Replica(IDS.deviceA, user, fakeClock());
  return [
    r.put('research', IDS.research1, {
      user_id: user,
      name: 'Techno',
      description: '',
      archived: false,
    }),
    r.put('research', IDS.research1, { name: 'Techno 2' }),
  ];
}

const own = opsOf(IDS.user);
/** Operação do próprio usuário que tenta gravar o registro em nome de outro. */
const reassign: Op = { ...own[1]!, fields: { user_id: OTHER_USER } };

const opCases = [
  { name: 'mesmo usuário', user: IDS.user, op: own[0]!, accepted: true },
  { name: 'mesmo usuário, sem campo user_id', user: IDS.user, op: own[1]!, accepted: true },
  { name: 'autor de outro usuário', user: IDS.user, op: opsOf(OTHER_USER)[0]!, accepted: false },
  { name: 'grava user_id de outro usuário', user: IDS.user, op: reassign, accepted: false },
];

const pairingCases: {
  name: string;
  host: string;
  joiner: string | null;
  can_adopt: boolean;
  expected: PairingUserDecision;
}[] = [
  { name: 'mesmo usuário', host: IDS.user, joiner: IDS.user, can_adopt: false, expected: 'same' },
  { name: 'cliente antigo', host: IDS.user, joiner: null, can_adopt: false, expected: 'same' },
  { name: 'vazio adota', host: IDS.user, joiner: OTHER_USER, can_adopt: true, expected: 'adopt' },
  {
    name: 'biblioteca de outro usuário',
    host: IDS.user,
    joiner: OTHER_USER,
    can_adopt: false,
    expected: 'foreign',
  },
];

describe('isolamento por usuário', () => {
  it('spec/vectors/isolation.json está atualizado', async () => {
    await expect(
      pretty({
        version: 1,
        description:
          'Isolamento por usuário. `ops`: a réplica do usuário `user` aceita a operação? `pairing`: decisão do pareamento.',
        ops: opCases,
        pairing: pairingCases,
      }),
    ).toMatchFileSnapshot(spec);
  });

  it('os casos do arquivo valem para isSameUser e pairingUserDecision', () => {
    const file = JSON.parse(readFileSync(spec, 'utf8')) as {
      ops: typeof opCases;
      pairing: typeof pairingCases;
    };
    for (const c of file.ops) expect(isSameUser(validateOp(c.op), c.user), c.name).toBe(c.accepted);
    for (const c of file.pairing) {
      expect(pairingUserDecision(c.host, c.joiner ?? undefined, c.can_adopt), c.name).toBe(
        c.expected,
      );
    }
  });

  it('a réplica recusa o lote inteiro se houver uma operação de outro usuário', () => {
    const r = new Replica(IDS.deviceB, IDS.user, fakeClock());
    const foreign = opsOf(OTHER_USER);
    expect(() => r.receive(foreign)).toThrow(ForeignUserError);
    expect(r.records.size).toBe(0);
    expect(r.vv).toEqual({});
    expect(r.receive(own)).toBe(2);
    expect(() => assertSameUser([own[0]!, reassign], IDS.user)).toThrow(/usuários diferentes/);
  });
});
