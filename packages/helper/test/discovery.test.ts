import { afterEach, describe, expect, it } from 'vitest';
import { Discovery, type Discovered } from '../src/discovery';

const running: Discovery[] = [];
afterEach(() => running.splice(0).forEach((d) => d.stop()));

describe('descoberta mDNS', () => {
  it('dois aparelhos na mesma rede se encontram pelo _cuepoint._tcp', async () => {
    const found: Discovered[] = [];
    const a = new Discovery();
    const b = new Discovery();
    running.push(a, b);
    a.start({
      deviceId: 'aaaaaaaa-0000-4000-8000-00000000000a',
      name: 'A',
      port: 47901,
      onFound: () => undefined,
    });
    b.start({
      deviceId: 'bbbbbbbb-0000-4000-8000-00000000000b',
      name: 'B',
      port: 47902,
      onFound: (d) => found.push(d),
    });
    for (let i = 0; i < 50 && !found.some((f) => f.deviceId.startsWith('aaaaaaaa')); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const a1 = found.find((f) => f.deviceId.startsWith('aaaaaaaa'));
    expect(a1?.port).toBe(47901);
    expect(a1?.addresses.length).toBeGreaterThan(0);
  });
});
