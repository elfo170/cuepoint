import { SERVICE_TYPE } from '@cuepoint/core';
import { Bonjour, type Service } from 'bonjour-service';

export interface Discovered {
  deviceId: string;
  addresses: string[];
  port: number;
}

/**
 * Descoberta local por mDNS/DNS-SD (PRD §5.2): anuncia `_cuepoint._tcp` e procura outros
 * aparelhos. A identidade vem no TXT (`id`); a confiança vem do pareamento, não do anúncio.
 */
export class Discovery {
  private bonjour: Bonjour | null = null;

  start(params: {
    deviceId: string;
    name: string;
    port: number;
    onFound: (d: Discovered) => void;
  }): void {
    try {
      this.bonjour = new Bonjour();
      this.bonjour.publish({
        name: `CuePoint ${params.name} ${params.deviceId.slice(0, 8)}`,
        type: SERVICE_TYPE,
        port: params.port,
        txt: { id: params.deviceId, v: '1' },
      });
      const browser = this.bonjour.find({ type: SERVICE_TYPE }) as unknown as {
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
    } catch (e) {
      console.error('[cuepoint-helper] mDNS indisponível:', (e as Error).message);
    }
  }

  stop(): void {
    try {
      this.bonjour?.unpublishAll();
      this.bonjour?.destroy();
    } catch {
      // ignore
    }
    this.bonjour = null;
  }
}
