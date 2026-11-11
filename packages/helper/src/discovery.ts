import os from 'node:os';
import { SERVICE_TYPE } from '@cuepoint/core';
import { Bonjour, type Service } from 'bonjour-service';

export interface Discovered {
  deviceId: string;
  addresses: string[];
  port: number;
}

export interface DiscoveryParams {
  deviceId: string;
  name: string;
  port: number;
  onFound: (d: Discovered) => void;
}

/**
 * Endereços IPv4 das placas de rede locais, sem loopback e sem autoconfiguração (169.254.x).
 * Cada um recebe uma instância própria de mDNS.
 */
export function lanAddresses(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const out = new Set<string>();
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.add(a.address);
    }
  }
  return [...out].sort();
}

/**
 * Descoberta local por mDNS/DNS-SD (PRD §5.2): anuncia `_cuepoint._tcp` e procura outros
 * aparelhos. A identidade vem no TXT (`id`); a confiança vem do pareamento, não do anúncio.
 *
 * Uma instância de mDNS por placa de rede: com uma só, o sistema escolhe a placa do multicast e,
 * com placas virtuais (VirtualBox, Hyper-V, VPN) de mesma prioridade, pode escutar e responder na
 * placa errada — as perguntas do celular chegam pelo cabo/Wi-Fi e ficam sem resposta. As placas
 * são reavaliadas periodicamente (notebook que troca de rede, cabo ligado depois).
 */
export class Discovery {
  private instances: Bonjour[] = [];
  private params: DiscoveryParams | null = null;
  private current: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly listAddresses: () => string[] = () => lanAddresses(),
    private readonly refreshMs = 30_000,
  ) {}

  start(params: DiscoveryParams): void {
    this.params = params;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.refreshMs);
    this.timer.unref?.();
  }

  /** Placas abertas no momento (uma instância de mDNS cada; `default` = interface padrão). */
  get interfaces(): string[] {
    return this.current === null ? [] : this.current === '' ? ['default'] : this.current.split(',');
  }

  private refresh(): void {
    if (!this.params) return;
    const addresses = this.listAddresses();
    const key = addresses.join(',');
    if (this.instances.length && key === this.current) return;
    this.close();
    this.current = key;
    // Sem placa de rede reconhecida: uma instância na interface padrão do sistema.
    for (const iface of addresses.length ? addresses : [undefined]) {
      const b = this.open(this.params, iface);
      if (b) this.instances.push(b);
    }
  }

  private open(params: DiscoveryParams, iface: string | undefined): Bonjour | null {
    const label = iface ?? 'padrão';
    try {
      // O tipo do construtor não declara as opções do multicast-dns, mas elas são repassadas a ele.
      const opts = (iface ? { interface: iface } : {}) as ConstructorParameters<typeof Bonjour>[0];
      const bonjour = new Bonjour(opts, (e: Error) =>
        console.error(`[cuepoint-helper] mDNS (${label}):`, e.message),
      );
      bonjour.publish({
        name: `CuePoint ${params.name} ${params.deviceId.slice(0, 8)}`,
        type: SERVICE_TYPE,
        port: params.port,
        txt: { id: params.deviceId, v: '1' },
        // O nome já é único (id do aparelho); a sondagem faria as instâncias deste mesmo PC
        // (uma por placa) se acusarem de conflito.
        probe: false,
      });
      const browser = bonjour.find({ type: SERVICE_TYPE }) as unknown as {
        on(event: 'up' | 'update', fn: (s: Service) => void): void;
      };
      const handle = (s: Service) => {
        const id = (s.txt as Record<string, string> | undefined)?.id;
        if (!id || id === params.deviceId) return;
        const addresses = (s.addresses ?? []).filter((a) => a.includes('.'));
        if (addresses.length) params.onFound({ deviceId: id, addresses, port: s.port });
      };
      browser.on('up', handle);
      browser.on('update', handle);
      return bonjour;
    } catch (e) {
      console.error(`[cuepoint-helper] mDNS indisponível (${label}):`, (e as Error).message);
      return null;
    }
  }

  private close(): void {
    for (const b of this.instances.splice(0)) {
      try {
        b.unpublishAll();
        b.destroy();
      } catch {
        // ignore
      }
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.close();
    this.params = null;
    this.current = null;
  }
}
