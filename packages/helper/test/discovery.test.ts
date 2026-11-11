import { afterEach, describe, expect, it } from 'vitest';
import { Discovery, lanAddresses, type Discovered } from '../src/discovery';

const running: Discovery[] = [];
afterEach(() => running.splice(0).forEach((d) => d.stop()));

const nic = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false) =>
  ({ address, family, internal, netmask: '', mac: '00:11:22:33:44:55', cidr: null }) as never;

describe('placas de rede para o mDNS', () => {
  it('usa só IPv4 de placas reais, sem loopback nem 169.254.x, sem repetir', () => {
    const addrs = lanAddresses({
      Loopback: [nic('127.0.0.1', 'IPv4', true)],
      Ethernet: [nic('192.168.1.14'), nic('fe80::1', 'IPv6')],
      VirtualBox: [nic('192.168.56.1')],
      SemDhcp: [nic('169.254.10.20')],
      Repetida: [nic('192.168.1.14')],
    });
    expect(addrs).toEqual(['192.168.1.14', '192.168.56.1']);
  });

  it('sem placa reconhecida, abre uma instância na interface padrão', () => {
    const d = new Discovery(() => [], 60_000);
    running.push(d);
    d.start({
      deviceId: 'cccccccc-0000-4000-8000-00000000000c',
      name: 'C',
      port: 47903,
      onFound: () => undefined,
    });
    expect(d.interfaces).toEqual(['default']);
    d.stop();
    expect(d.interfaces).toEqual([]);
  });

  it('reabre o mDNS quando as placas mudam (ex.: cabo ligado depois)', async () => {
    let addrs: string[] = [];
    const d = new Discovery(() => addrs, 50);
    running.push(d);
    d.start({
      deviceId: 'dddddddd-0000-4000-8000-00000000000d',
      name: 'D',
      port: 47904,
      onFound: () => undefined,
    });
    expect(d.interfaces).toEqual(['default']);
    const real = lanAddresses();
    if (!real.length) return; // máquina sem rede: nada a reabrir
    addrs = real;
    await new Promise((r) => setTimeout(r, 200));
    expect(d.interfaces).toEqual(real);
  });
});

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
