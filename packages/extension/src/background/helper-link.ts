import type { Op, VersionVector } from '@cuepoint/core';
import type { Store } from '../data/store';

export const HOST_NAME = 'com.cuepoint.helper';
/** Respostas do serviço para o Chrome são limitadas a 1 MB: envia/recebe em lotes. */
export const BATCH = 200;

/** Porta mínima (subconjunto de chrome.runtime.Port), para permitir testes. */
export interface PortLike {
  postMessage(msg: unknown): void;
  onMessage: { addListener(fn: (msg: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
  disconnect(): void;
}

export type HelperState = 'absent' | 'connecting' | 'connected' | 'error';

export interface HelperStatus {
  state: HelperState;
  error: string | null;
  info: Record<string, unknown> | null;
  lastSyncAt: string | null;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Ligação com o serviço auxiliar do Windows (Native Messaging). Sem o serviço instalado, a
 * extensão funciona sozinha (MVP); com ele, troca operações para sincronizar com outros aparelhos.
 */
export class HelperLink {
  private port: PortLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private syncing: Promise<void> | null = null;
  private listeners = new Set<(event: string, data: unknown) => void>();
  status: HelperStatus = { state: 'absent', error: null, info: null, lastSyncAt: null };

  constructor(
    private readonly store: Store,
    private readonly connectNative: () => PortLike = () =>
      chrome.runtime.connectNative(HOST_NAME) as PortLike,
    private readonly lastError: () => string | undefined = () => chrome.runtime.lastError?.message,
  ) {}

  onEvent(fn: (event: string, data: unknown) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get connected(): boolean {
    return this.status.state === 'connected';
  }

  /** Conecta (se ainda não estiver) e vincula o serviço a este aparelho. */
  async connect(): Promise<boolean> {
    if (this.port && this.connected) return true;
    this.status = { ...this.status, state: 'connecting', error: null };
    try {
      const port = this.connectNative();
      this.port = port;
      port.onMessage.addListener((msg) => this.onMessage(msg as Record<string, unknown>));
      port.onDisconnect.addListener(() => {
        const err = this.lastError();
        this.port = null;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(err ?? 'serviço desconectado'));
        }
        this.pending.clear();
        const absent = !err || /not found|não encontrado|forbidden/i.test(err);
        this.status = { ...this.status, state: absent ? 'absent' : 'error', error: err ?? null };
      });
      const { user, device } = await this.store.init();
      const info = await this.request<Record<string, unknown>>({
        type: 'hello',
        deviceId: device.id,
        userId: user.id,
        deviceName: device.device_name,
      });
      this.status = { ...this.status, state: 'connected', error: null, info };
      return true;
    } catch (e) {
      if (this.status.state !== 'absent') {
        this.status = { ...this.status, state: 'error', error: (e as Error).message };
      }
      this.port?.disconnect();
      this.port = null;
      return false;
    }
  }

  request<T = unknown>(req: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const port = this.port;
    if (!port) return Promise.reject(new Error('serviço auxiliar não conectado'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('serviço auxiliar não respondeu'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      port.postMessage({ id, req });
    });
  }

  private onMessage(msg: Record<string, unknown>) {
    if ('event' in msg) {
      for (const l of this.listeners) l(String(msg.event), msg.data);
      if (msg.event === 'error') {
        this.status = { ...this.status, state: 'error', error: String(msg.data) };
      }
      return;
    }
    const p = this.pending.get(Number(msg.id));
    if (!p) return;
    this.pending.delete(Number(msg.id));
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(String(msg.error)));
  }

  /**
   * Sincronização local extensão ⇄ serviço: compacta o que ainda não saiu daqui, envia o que
   * o serviço não tem (todas as origens) e recebe o que ele trouxe de outros aparelhos.
   */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      try {
        if (!(await this.connect())) return;
        await this.store.compactPending();
        const info = await this.request<{ vv: VersionVector }>({ type: 'status' });
        const outgoing = await this.store.opsSince(info.vv);
        for (let i = 0; i < outgoing.length; i += BATCH) {
          const batch = outgoing.slice(i, i + BATCH);
          await this.request({ type: 'push', ops: batch });
          await this.store.markSent(batch);
        }
        for (;;) {
          const res = await this.request<{ ops: Op[]; more: boolean }>({
            type: 'pull',
            vv: await this.store.versionVector(),
            limit: BATCH,
          });
          if (res.ops.length) await this.store.receive(res.ops);
          if (!res.more || !res.ops.length) break;
        }
        this.status = {
          ...this.status,
          lastSyncAt: new Date().toISOString(),
          info: await this.request<Record<string, unknown>>({ type: 'status' }),
        };
      } catch (e) {
        this.status = { ...this.status, error: (e as Error).message };
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }
}
