import { describe, expect, it } from 'vitest';
import {
  compareHlc,
  decisionId,
  deterministicId,
  formatHlc,
  HlcClock,
  hlcToIso,
  isUuid,
  MAX_DRIFT_MS,
  newId,
  opId,
  parseHlc,
  trackIdFromUrn,
} from '../src';

describe('HLC', () => {
  it('formata e interpreta', () => {
    const h = formatHlc({ ms: 1_767_225_600_000, counter: 7, node: 'dev' });
    expect(h).toBe('001767225600000:000007:dev');
    expect(parseHlc(h)).toEqual({ ms: 1_767_225_600_000, counter: 7, node: 'dev' });
    expect(hlcToIso(h)).toBe('2026-01-01T00:00:00.000Z');
    expect(() => parseHlc('x')).toThrow();
  });

  it('comparação textual segue a ordem (ms, contador, nó)', () => {
    const a = formatHlc({ ms: 999, counter: 5, node: 'z' });
    const b = formatHlc({ ms: 1000, counter: 0, node: 'a' });
    const c = formatHlc({ ms: 1000, counter: 1, node: 'a' });
    expect([c, b, a].sort()).toEqual([a, b, c]);
    expect(compareHlc(a, b)).toBe(-1);
  });

  it('é monotônico mesmo com relógio parado ou voltando', () => {
    let wall = 5000;
    const clock = new HlcClock('n', null, () => wall);
    const t1 = clock.tick();
    const t2 = clock.tick();
    wall = 4000;
    const t3 = clock.tick();
    expect(t1 < t2 && t2 < t3).toBe(true);
  });

  it('avança além de timestamps recebidos', () => {
    const clock = new HlcClock('n', null, () => 1000);
    clock.receive(formatHlc({ ms: 50_000, counter: 3, node: 'm' }));
    expect(clock.tick() > formatHlc({ ms: 50_000, counter: 3, node: 'm' })).toBe(true);
  });

  it('recusa relógios remotos absurdamente adiantados', () => {
    const clock = new HlcClock('n', null, () => 1000);
    expect(() =>
      clock.receive(formatHlc({ ms: 1000 + MAX_DRIFT_MS + 1, counter: 0, node: 'm' })),
    ).toThrow();
  });

  it('retoma a partir do último valor persistido', () => {
    const last = formatHlc({ ms: 9_000, counter: 2, node: 'n' });
    const clock = new HlcClock('n', last, () => 1);
    expect(clock.tick()).toBe(formatHlc({ ms: 9_000, counter: 3, node: 'n' }));
  });
});

describe('ids', () => {
  it('gera UUIDv7 válidos e únicos', () => {
    const a = newId();
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(newId()).not.toBe(a);
  });

  it('ids determinísticos são estáveis entre execuções e plataformas', () => {
    expect(deterministicId('x')).toBe(deterministicId('x'));
    expect(trackIdFromUrn('soundcloud:tracks:1')).toBe(trackIdFromUrn('soundcloud:tracks:1'));
    expect(decisionId('a', 'b')).not.toBe(decisionId('b', 'a'));
    expect(opId('dev', 1)).not.toBe(opId('dev', 2));
  });
});
