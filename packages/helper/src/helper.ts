import type { Op, VersionVector } from '@cuepoint/core';
import { EventEmitter } from 'node:events';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HelperDb } from './db';
import { loadOrCreateKeys, type Keys } from './identity';

export interface HelperOptions {
  dataDir: string;
  port: number;
  /** Nome do named pipe (IPC local com a extensão). */
  pipe: string;
  now?: () => number;
}

export interface LocalIdentity {
  deviceId: string;
  userId: string;
  name: string;
}

/** Mensagens da extensão (via shim de Native Messaging) para o serviço. */
export type LocalRequest =
  | { type: 'hello'; deviceId: string; userId: string; deviceName: string }
  | { type: 'status' }
  | { type: 'pull'; vv: VersionVector; limit?: number }
  | { type: 'push'; ops: Op[] }
  | { type: 'backup:write'; filename: string; content: string }
  | { type: string; [k: string]: unknown };

/** Eventos do serviço para a extensão. */
export interface HelperEvents {
  ops: [count: number];
  changed: [];
  peers: [];
  approval: [peer: { device_id: string; name: string }];
  /** Estado da conexão com o SoundCloud mudou (login, renovação falhou, desconexão). */
  sc: [status: unknown];
}

export const PULL_PAGE = 200;

/**
 * Núcleo do serviço auxiliar. O PC é um único aparelho: o serviço adota o id da extensão e
 * guarda uma réplica do log (store-and-forward) para sincronizar com outros aparelhos mesmo
 * com o Chrome fechado.
 */
export class Helper extends EventEmitter<HelperEvents> {
  readonly db: HelperDb;
  keys!: Keys;
  /** Porta efetiva do servidor na LAN (definida quando ele sobe). */
  portProvider?: () => number;
  private handlers = new Map<
    string,
    (req: Record<string, unknown>) => Promise<unknown> | unknown
  >();

  constructor(readonly opts: HelperOptions) {
    super();
    mkdirSync(opts.dataDir, { recursive: true });
    this.db = new HelperDb(join(opts.dataDir, 'helper.db'));
    this.register('hello', (r) => this.hello(r as never));
    this.register('status', () => this.status());
    this.register('pull', (r) =>
      this.db.opsSince((r.vv as VersionVector) ?? {}, Number(r.limit ?? PULL_PAGE)),
    );
    this.register('push', (r) => {
      const inserted = this.insertOps((r.ops as unknown[]) ?? []);
      if (inserted.length) this.emit('changed');
      return { applied: inserted.length, vv: this.db.versionVector() };
    });
    this.register('backup:write', (r) => this.writeBackup(String(r.filename), String(r.content)));
  }

  now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  async start(): Promise<void> {
    this.keys = await loadOrCreateKeys(join(this.opts.dataDir, 'keys'), 'CuePoint');
  }

  /** Permite que outros módulos (pareamento, sync) registrem tratadores de mensagens locais. */
  register(
    type: string,
    handler: (req: Record<string, unknown>) => Promise<unknown> | unknown,
  ): void {
    this.handlers.set(type, handler);
  }

  async handleLocal(req: LocalRequest): Promise<unknown> {
    const handler = this.handlers.get(req.type);
    if (!handler) throw new Error(`mensagem desconhecida: ${req.type}`);
    if (req.type !== 'hello' && req.type !== 'status' && !this.identity) {
      throw new Error('serviço ainda não vinculado à extensão (hello)');
    }
    return handler(req as Record<string, unknown>);
  }

  /** Insere operações recebidas, recusando as de outro usuário (isolamento, PRD §16). */
  insertOps(ops: unknown[]): Op[] {
    return this.db.insertOps(ops, this.identity?.userId);
  }

  get identity(): LocalIdentity | undefined {
    const raw = this.db.getMeta('identity');
    return raw ? (JSON.parse(raw) as LocalIdentity) : undefined;
  }

  private hello(r: { deviceId: string; userId: string; deviceName: string }) {
    const current = this.identity;
    if (current && current.deviceId !== r.deviceId) {
      throw new Error(
        `Este serviço já pertence ao aparelho ${current.name} (${current.deviceId}). Restaure o backup desse aparelho ou reinstale o serviço.`,
      );
    }
    if (current && current.userId !== r.userId && this.db.count() > 0) {
      throw new Error(
        'Este serviço guarda a biblioteca de outro usuário. Restaure o backup desse usuário ou reinstale o serviço.',
      );
    }
    const next = { deviceId: r.deviceId, userId: r.userId, name: r.deviceName };
    this.db.setMeta('identity', JSON.stringify(next));
    return this.status();
  }

  status() {
    return {
      linked: !!this.identity,
      identity: this.identity ?? null,
      ops: this.db.count(),
      vv: this.db.versionVector(),
      port: this.portProvider?.() ?? this.opts.port,
      certFp: this.keys?.certFp ?? null,
      publicKey: this.keys?.publicKeyB64 ?? null,
      dataDir: this.opts.dataDir,
      version: 1,
    };
  }

  /** Grava um backup com escrita atômica (arquivo temporário + rename). Nunca apaga antigos. */
  writeBackup(filename: string, content: string): { path: string } {
    if (!/^[\w.-]+\.json$/.test(filename)) throw new Error('nome de arquivo inválido');
    const dir = join(this.opts.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    const target = join(dir, filename);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, target);
    return { path: target };
  }

  close(): void {
    this.db.close();
  }
}
