import { opsMissingFrom, validateOp, type Op, type VersionVector } from '@cuepoint/core';
import { DatabaseSync } from 'node:sqlite';

export type PeerStatus = 'pending' | 'paired' | 'revoked';
export type SyncPolicy = 'auto' | 'ask';

export interface Peer {
  device_id: string;
  name: string;
  /** Chave pública de assinatura (SPKI DER base64). */
  public_key: string;
  /** Fingerprint do certificado TLS do par (se ele também for servidor). */
  cert_fp: string | null;
  addresses: string[];
  port: number | null;
  status: PeerStatus;
  policy: SyncPolicy;
  /** Código de verificação mostrado no pareamento. */
  sas: string | null;
  paired_at: string;
  last_sync_at: string | null;
  last_seen_at: string | null;
}

export interface SyncRun {
  id: number;
  peer_id: string;
  direction: 'in' | 'out';
  started_at: string;
  finished_at: string | null;
  received: number;
  sent: number;
  status: 'ok' | 'error' | 'running' | 'approval_required';
  error: string | null;
}

/**
 * Armazenamento do serviço auxiliar (SQLite nativo do Node): réplica do log de operações
 * (store-and-forward, sem materializar registros), pares, execuções de sync e tokens.
 */
export class HelperDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS ops (
        op_id TEXT PRIMARY KEY, origin TEXT NOT NULL, seq INTEGER NOT NULL, hlc TEXT NOT NULL,
        json TEXT NOT NULL, UNIQUE (origin, seq));
      CREATE INDEX IF NOT EXISTS ops_hlc ON ops (hlc);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS peers (
        device_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairing_tokens (
        token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, peer_id TEXT NOT NULL, direction TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, received INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT);
    `);
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  // ---------------------------------------------------------------- log

  versionVector(): VersionVector {
    const rows = this.db
      .prepare('SELECT origin, MAX(seq) AS seq FROM ops GROUP BY origin')
      .all() as {
      origin: string;
      seq: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.origin, Number(r.seq)]));
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM ops').get() as { n: number }).n);
  }

  /** Operações que o detentor de `vv` não tem, em ordem causal, paginadas. */
  opsSince(vv: VersionVector, limit = Number.MAX_SAFE_INTEGER): { ops: Op[]; more: boolean } {
    const rows = this.db.prepare('SELECT json FROM ops ORDER BY hlc').all() as { json: string }[];
    const missing = opsMissingFrom(
      rows.map((r) => JSON.parse(r.json) as Op),
      vv,
    );
    return { ops: missing.slice(0, limit), more: missing.length > limit };
  }

  /**
   * Insere operações recebidas (idempotente, exige entrega causal por origem).
   * Retorna as operações efetivamente novas.
   */
  insertOps(input: unknown[]): Op[] {
    const ops = input.map(validateOp).sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
    const vv = this.versionVector();
    const inserted: Op[] = [];
    const stmt = this.db.prepare(
      'INSERT INTO ops (op_id, origin, seq, hlc, json) VALUES (?, ?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      for (const op of ops) {
        const have = vv[op.origin] ?? 0;
        if (op.seq <= have) continue;
        if (op.seq !== have + 1)
          throw new Error(`lacuna em ${op.origin}: esperado ${have + 1}, recebido ${op.seq}`);
        stmt.run(op.op_id, op.origin, op.seq, op.hlc, JSON.stringify(op));
        vv[op.origin] = op.seq;
        inserted.push(op);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /**
   * Substitui operações ainda não repassadas a nenhum par (compactação feita pela extensão).
   * Só é permitido se nenhuma das operações removidas foi enviada a outro aparelho.
   */
  replaceUnsent(origin: string, fromSeq: number, ops: Op[]): void {
    const forwarded = Number(this.getMeta(`forwarded:${origin}`) ?? 0);
    if (fromSeq <= forwarded) throw new Error('operações já repassadas não podem ser substituídas');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM ops WHERE origin = ? AND seq >= ?').run(origin, fromSeq);
      const stmt = this.db.prepare(
        'INSERT INTO ops (op_id, origin, seq, hlc, json) VALUES (?, ?, ?, ?, ?)',
      );
      for (const op of ops.map(validateOp))
        stmt.run(op.op_id, op.origin, op.seq, op.hlc, JSON.stringify(op));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Registra até onde as operações de `origin` já foram repassadas a algum par. */
  markForwarded(ops: Op[]): void {
    const max: Record<string, number> = {};
    for (const op of ops) max[op.origin] = Math.max(max[op.origin] ?? 0, op.seq);
    for (const [origin, seq] of Object.entries(max)) {
      const cur = Number(this.getMeta(`forwarded:${origin}`) ?? 0);
      if (seq > cur) this.setMeta(`forwarded:${origin}`, String(seq));
    }
  }

  // ---------------------------------------------------------------- pares

  peers(): Peer[] {
    return (this.db.prepare('SELECT json FROM peers').all() as { json: string }[]).map(
      (r) => JSON.parse(r.json) as Peer,
    );
  }

  peer(id: string): Peer | undefined {
    const row = this.db.prepare('SELECT json FROM peers WHERE device_id = ?').get(id) as
      { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Peer) : undefined;
  }

  savePeer(peer: Peer): void {
    this.db
      .prepare(
        'INSERT INTO peers (device_id, json) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET json = excluded.json',
      )
      .run(peer.device_id, JSON.stringify(peer));
  }

  updatePeer(id: string, changes: Partial<Peer>): Peer | undefined {
    const peer = this.peer(id);
    if (!peer) return undefined;
    const next = { ...peer, ...changes };
    this.savePeer(next);
    return next;
  }

  // ---------------------------------------------------------------- tokens

  createToken(token: string, ttlMs: number, now = Date.now()): void {
    this.db.prepare('DELETE FROM pairing_tokens WHERE expires_at < ?').run(now);
    this.db
      .prepare('INSERT INTO pairing_tokens (token, expires_at) VALUES (?, ?)')
      .run(token, now + ttlMs);
  }

  /** Consome um token de uso único. */
  consumeToken(token: string, now = Date.now()): boolean {
    const r = this.db
      .prepare(
        'UPDATE pairing_tokens SET used = 1 WHERE token = ? AND used = 0 AND expires_at >= ?',
      )
      .run(token, now);
    return Number(r.changes) === 1;
  }

  // ---------------------------------------------------------------- sync_runs

  startRun(peerId: string, direction: SyncRun['direction']): number {
    const r = this.db
      .prepare(
        "INSERT INTO sync_runs (peer_id, direction, started_at, status) VALUES (?, ?, ?, 'running')",
      )
      .run(peerId, direction, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  finishRun(
    id: number,
    result: { received: number; sent: number; status: SyncRun['status']; error?: string },
  ): void {
    this.db
      .prepare(
        'UPDATE sync_runs SET finished_at = ?, received = ?, sent = ?, status = ?, error = ? WHERE id = ?',
      )
      .run(
        new Date().toISOString(),
        result.received,
        result.sent,
        result.status,
        result.error ?? null,
        id,
      );
  }

  runs(peerId?: string, limit = 50): SyncRun[] {
    const rows = peerId
      ? this.db
          .prepare('SELECT * FROM sync_runs WHERE peer_id = ? ORDER BY id DESC LIMIT ?')
          .all(peerId, limit)
      : this.db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?').all(limit);
    return rows as unknown as SyncRun[];
  }
}
