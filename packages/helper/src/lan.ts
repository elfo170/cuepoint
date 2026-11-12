import {
  FOREIGN_USER_MESSAGE,
  ForeignUserError,
  mergeVersionVectors,
  formatPairingUri,
  pairingCode,
  pairingUserDecision,
  parsePairingUri,
  PROTOCOL_VERSION,
  PULL_LIMIT,
  type Op,
  type PairingPayload,
  type VersionVector,
} from '@cuepoint/core';
import { randomBytes, X509Certificate } from 'node:crypto';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { TLSSocket } from 'node:tls';
import { NonceCache, signRequest, verifyRequest } from './auth';
import { vvOf, type Peer, type SyncPolicy } from './db';
import type { Helper } from './helper';
import { spkiFingerprint } from './identity';

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 32 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Endereços IPv4 da máquina na rede local (para o QR de pareamento). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.length ? out : ['127.0.0.1'];
}

/**
 * Servidor HTTPS na LAN + cliente para outros aparelhos (PRD §5).
 * - TLS com certificado autoassinado; o par fixa o fingerprint recebido no QR.
 * - Toda requisição (exceto hello e pair) é assinada com a chave do aparelho pareado.
 * - Política por par: `auto` ou `ask` (exige aprovação no PC, válida por 10 min).
 */
export class Lan {
  server: Server | null = null;
  private nonces = new NonceCache();
  private approvals = new Map<string, number>();
  /** Pedidos de aprovação pendentes (par → quando pediu). */
  readonly pendingApprovals = new Map<string, number>();
  private syncing = new Map<string, Promise<SyncResult>>();

  constructor(
    private readonly helper: Helper,
    private readonly addresses: () => string[] = lanAddresses,
  ) {
    const h = helper;
    h.register('pairing:create', () => this.createPairing());
    h.register('pairing:join', (r) => this.joinPairing(String(r.uri), r.canAdopt === true));
    h.register('peers:list', () => this.listPeers());
    h.register('peer:confirm', (r) => this.confirmPeer(String(r.peerId)));
    h.register('peer:update', (r) => this.updatePeer(String(r.peerId), r as never));
    h.register('peer:revoke', (r) => this.revokePeer(String(r.peerId)));
    h.register('peer:sync', (r) => this.syncWith(String(r.peerId)));
    h.register('approval:grant', (r) => this.grant(String(r.peerId)));
    h.register('runs:list', (r) => this.helper.db.runs(r.peerId ? String(r.peerId) : undefined));
  }

  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? this.helper.opts.port;
  }

  async listen(): Promise<number> {
    const { certPem, keyPem } = this.helper.keys;
    this.server = createServer({ cert: certPem, key: keyPem }, (req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        this.route(req.method ?? 'GET', req.url ?? '/', req.headers, body)
          .then((data) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(data));
          })
          .catch((e: unknown) => {
            const status = e instanceof HttpError ? e.status : 500;
            const code = e instanceof HttpError ? e.code : (e as Error).message;
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: code }));
          });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.helper.opts.port, '0.0.0.0', () => resolve());
    });
    return this.port;
  }

  async close(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server?.closeAllConnections?.();
  }

  private requireIdentity() {
    const id = this.helper.identity;
    if (!id) throw new HttpError(503, 'not_linked');
    return id;
  }

  // ------------------------------------------------------------------ servidor

  private async route(
    method: string,
    url: string,
    headers: Record<string, string | string[] | undefined>,
    body: string,
  ) {
    const path = url.split('?')[0]!;
    const id = this.requireIdentity();
    if (method === 'GET' && path === '/v1/hello') {
      return {
        device_id: id.deviceId,
        name: id.name,
        proto: PROTOCOL_VERSION,
        cert_fp: this.helper.keys.certFp,
      };
    }
    if (method === 'POST' && path === '/v1/pair') return this.acceptPairing(body);

    const v = verifyRequest({
      headers,
      method,
      path,
      body,
      nonces: this.nonces,
      now: this.helper.now(),
      publicKeyOf: (deviceId) => this.helper.db.peer(deviceId)?.public_key,
    });
    if (!v.ok) throw new HttpError(v.status, v.error);
    const peer = this.helper.db.peer(v.deviceId)!;
    this.helper.db.updatePeer(peer.device_id, { last_seen_at: new Date().toISOString() });
    if (path === '/v1/revoke' && method === 'POST') {
      this.helper.db.updatePeer(peer.device_id, { status: 'revoked' });
      this.helper.emit('peers');
      return { ok: true };
    }
    if (peer.status === 'pending') throw new HttpError(403, 'pending_confirmation');
    if (peer.status === 'revoked') throw new HttpError(403, 'revoked');
    if (peer.user_id && peer.user_id !== id.userId) throw new HttpError(409, 'foreign_user');
    if (!this.approved(peer)) throw new HttpError(409, 'approval_required');

    const payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    if (method === 'POST' && path === '/v1/sync/pull') {
      const limit = Math.min(Number(payload.limit ?? PULL_LIMIT), PULL_LIMIT);
      const page = this.helper.db.opsSince((payload.vv as VersionVector) ?? {}, limit);
      this.helper.db.markForwarded(page.ops);
      // o par tinha `vv` e agora recebe esta página
      this.helper.db.noteKnown(
        peer.device_id,
        mergeVersionVectors((payload.vv as VersionVector) ?? {}, vvOf(page.ops)),
      );
      if (!page.more) this.recordRun(peer.device_id, 'in', 0, page.ops.length);
      return { ...page, vv: this.helper.db.versionVector() };
    }
    if (method === 'POST' && path === '/v1/sync/push') {
      const pushed = (payload.ops as unknown[]) ?? [];
      let inserted: Op[];
      try {
        inserted = this.helper.insertOps(pushed);
      } catch (e) {
        if (e instanceof ForeignUserError) throw new HttpError(409, 'foreign_user');
        throw e;
      }
      // quem enviou tem, no mínimo, o que enviou (validado por insertOps)
      this.helper.db.noteKnown(peer.device_id, vvOf(pushed as Op[]));
      if (inserted.length) {
        this.helper.emit('changed');
        this.helper.emit('ops', inserted.length);
      }
      this.recordRun(peer.device_id, 'in', inserted.length, 0);
      return { applied: inserted.length, vv: this.helper.db.versionVector() };
    }
    throw new HttpError(404, 'not_found');
  }

  private recordRun(peerId: string, direction: 'in' | 'out', received: number, sent: number) {
    const run = this.helper.db.startRun(peerId, direction);
    this.helper.db.finishRun(run, { received, sent, status: 'ok' });
    this.helper.db.updatePeer(peerId, { last_sync_at: new Date().toISOString() });
    this.helper.emit('peers');
  }

  private approved(peer: Peer): boolean {
    if (peer.policy === 'auto') return true;
    const until = this.approvals.get(peer.device_id) ?? 0;
    if (until > this.helper.now()) return true;
    if (!this.pendingApprovals.has(peer.device_id)) {
      this.pendingApprovals.set(peer.device_id, this.helper.now());
      this.helper.emit('approval', { device_id: peer.device_id, name: peer.name });
    }
    return false;
  }

  grant(peerId: string) {
    this.approvals.set(peerId, this.helper.now() + APPROVAL_TTL_MS);
    this.pendingApprovals.delete(peerId);
    this.helper.emit('peers');
    return { until: this.approvals.get(peerId) };
  }

  // ------------------------------------------------------------------ pareamento

  /** Gera o QR/código de uso único (PRD §4.4). */
  createPairing(): { uri: string; payload: PairingPayload; expiresAt: number } {
    const id = this.requireIdentity();
    const token = randomBytes(16).toString('base64url');
    this.helper.db.createToken(token, PAIRING_TTL_MS, this.helper.now());
    const payload: PairingPayload = {
      v: PROTOCOL_VERSION,
      deviceId: id.deviceId,
      name: id.name,
      addresses: this.addresses(),
      port: this.port,
      certFp: this.helper.keys.certFp,
      publicKey: this.helper.keys.publicKeyB64,
      token,
    };
    return {
      uri: formatPairingUri(payload),
      payload,
      expiresAt: this.helper.now() + PAIRING_TTL_MS,
    };
  }

  /** Outro aparelho apresentou o token: registra como pendente até o usuário confirmar aqui. */
  private async acceptPairing(body: string) {
    const id = this.requireIdentity();
    const r = JSON.parse(body || '{}') as {
      token?: string;
      device_id?: string;
      name?: string;
      public_key?: string;
      cert_fp?: string | null;
      addresses?: string[];
      port?: number | null;
      /** Usuário de quem entra (ausente em clientes antigos). */
      user_id?: string;
      /** Quem entra está vazio e pode adotar o usuário deste aparelho. */
      can_adopt?: boolean;
    };
    if (!r.token || !r.device_id || !r.public_key || !r.name)
      throw new HttpError(400, 'bad_request');
    // Antes de consumir o token: o usuário pode apagar a biblioteca do outro aparelho e repetir.
    if (pairingUserDecision(id.userId, r.user_id, r.can_adopt === true) === 'foreign')
      throw new HttpError(409, 'foreign_user');
    if (!this.helper.db.consumeToken(r.token, this.helper.now()))
      throw new HttpError(403, 'invalid_token');
    const sas = await pairingCode(r.token, this.helper.keys.publicKeyB64, r.public_key);
    this.helper.db.savePeer({
      device_id: r.device_id,
      user_id: id.userId,
      name: r.name,
      public_key: r.public_key,
      cert_fp: r.cert_fp ?? null,
      addresses: r.addresses ?? [],
      port: r.port ?? null,
      status: 'pending',
      policy: 'ask',
      sas,
      paired_at: new Date().toISOString(),
      last_sync_at: null,
      last_seen_at: new Date().toISOString(),
    });
    this.helper.emit('peers');
    return {
      device_id: id.deviceId,
      name: id.name,
      user_id: id.userId,
      public_key: this.helper.keys.publicKeyB64,
      sas,
    };
  }

  /**
   * Este PC escaneou/colou o código de outro aparelho (ex.: outro PC). Com `extensionEmpty`
   * (a extensão confirmou que não tem nada registrado) e o serviço também vazio, este PC pode
   * adotar o usuário do outro: devolve `adoptedUserId` para a extensão adotar também.
   */
  async joinPairing(uri: string, extensionEmpty = false) {
    const id = this.requireIdentity();
    const p = parsePairingUri(uri);
    const canAdopt = extensionEmpty && this.helper.db.count() === 0;
    const body = JSON.stringify({
      token: p.token,
      device_id: id.deviceId,
      name: id.name,
      public_key: this.helper.keys.publicKeyB64,
      cert_fp: this.helper.keys.certFp,
      addresses: this.addresses(),
      port: this.port,
      user_id: id.userId,
      // o usuário do PC pertence à extensão: só adota se a extensão e o serviço estão vazios
      can_adopt: canAdopt,
    });
    let lastError: unknown;
    for (const address of p.addresses) {
      try {
        const res = (await this.httpsJson(
          address,
          p.port,
          p.certFp,
          'POST',
          '/v1/pair',
          body,
          false,
        )) as {
          device_id: string;
          user_id?: string;
          sas: string;
        };
        if (res.device_id !== p.deviceId) throw new Error('aparelho inesperado');
        const decision = res.user_id
          ? pairingUserDecision(res.user_id, id.userId, canAdopt)
          : 'same';
        if (decision === 'foreign') throw new ForeignUserError();
        const userId = decision === 'adopt' ? res.user_id! : id.userId;
        if (decision === 'adopt') {
          // a extensão adota o mesmo usuário ao receber `adoptedUserId` (hello confere depois)
          this.helper.db.setMeta('identity', JSON.stringify({ ...id, userId }));
        }
        this.helper.db.savePeer({
          device_id: p.deviceId,
          user_id: userId,
          name: p.name,
          public_key: p.publicKey,
          cert_fp: p.certFp,
          addresses: p.addresses,
          port: p.port,
          status: 'paired',
          policy: 'ask',
          sas: res.sas,
          paired_at: new Date().toISOString(),
          last_sync_at: null,
          last_seen_at: new Date().toISOString(),
        });
        this.helper.emit('peers');
        return {
          peerId: p.deviceId,
          name: p.name,
          sas: res.sas,
          adoptedUserId: decision === 'adopt' ? userId : null,
        };
      } catch (e) {
        if (e instanceof ForeignUserError) throw e;
        if (e instanceof HttpError && e.code === 'foreign_user')
          throw new ForeignUserError(FOREIGN_USER_MESSAGE);
        lastError = e;
      }
    }
    throw new Error(`não foi possível parear: ${(lastError as Error)?.message ?? 'sem endereço'}`);
  }

  listPeers() {
    return this.helper.db.peers().map((p) => ({
      ...p,
      approval_pending: this.pendingApprovals.has(p.device_id),
      approved_until: this.approvals.get(p.device_id) ?? null,
      // alterações que o par ainda não tem (null = ainda não houve troca com ele)
      pending: p.known_vv ? this.helper.db.pendingFor(p.known_vv) : null,
      last_run: this.helper.db.runs(p.device_id, 1)[0] ?? null,
    }));
  }

  confirmPeer(peerId: string) {
    const p = this.helper.db.updatePeer(peerId, { status: 'paired' });
    if (!p) throw new Error('aparelho desconhecido');
    this.helper.emit('peers');
    return p;
  }

  updatePeer(peerId: string, changes: { name?: string; policy?: SyncPolicy }) {
    const patch: Partial<Peer> = {};
    if (changes.name?.trim()) patch.name = changes.name.trim();
    if (changes.policy === 'auto' || changes.policy === 'ask') patch.policy = changes.policy;
    const p = this.helper.db.updatePeer(peerId, patch);
    this.helper.emit('peers');
    return p;
  }

  /** Remove a confiança no par (PRD §4.5) e avisa o par, se alcançável. */
  async revokePeer(peerId: string) {
    const peer = this.helper.db.peer(peerId);
    if (!peer) throw new Error('aparelho desconhecido');
    this.helper.db.updatePeer(peerId, { status: 'revoked' });
    this.approvals.delete(peerId);
    this.helper.emit('peers');
    if (peer.cert_fp && peer.port) {
      await this.signedJson(peer, 'POST', '/v1/revoke', '{}').catch(() => undefined);
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ cliente

  /** Requisição HTTPS com certificado fixado pelo fingerprint. */
  httpsJson(
    host: string,
    port: number,
    certFp: string,
    method: string,
    path: string,
    body: string,
    signed: boolean,
  ): Promise<unknown> {
    const id = this.helper.identity!;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signed) {
      Object.assign(
        headers,
        signRequest({
          deviceId: id.deviceId,
          privateKey: this.helper.keys.privateKey,
          method,
          path,
          body,
        }),
      );
    }
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host,
          port,
          method,
          path,
          headers: { ...headers, 'content-length': Buffer.byteLength(body) },
          rejectUnauthorized: false,
          timeout: 15_000,
          checkServerIdentity: () => undefined,
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const json = text ? JSON.parse(text) : {};
            if ((res.statusCode ?? 500) >= 400)
              reject(new HttpError(res.statusCode ?? 500, json.error ?? 'error'));
            else resolve(json);
          });
        },
      );
      // Fixação do certificado: só envia o corpo depois de conferir o fingerprint do servidor.
      req.on('socket', (socket) => {
        (socket as TLSSocket).once('secureConnect', () => {
          const cert = (socket as TLSSocket).getPeerX509Certificate?.();
          const fp = cert ? spkiFingerprint(cert.toString()) : null;
          if (fp !== certFp.toLowerCase()) {
            req.destroy(new Error('certificado do aparelho não confere'));
            return;
          }
          req.end(body);
        });
      });
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', reject);
    });
  }

  private async signedJson(
    peer: Peer,
    method: string,
    path: string,
    body: string,
  ): Promise<unknown> {
    if (!peer.cert_fp || !peer.port) throw new Error('par sem servidor');
    let lastError: unknown;
    for (const host of peer.addresses) {
      try {
        return await this.httpsJson(host, peer.port, peer.cert_fp, method, path, body, true);
      } catch (e) {
        lastError = e;
        if (e instanceof HttpError) throw e; // o par respondeu: não tenta outros endereços
      }
    }
    throw lastError ?? new Error('par sem endereço');
  }

  /** Sincroniza com outro serviço (PC ⇄ PC): recebe o que falta e envia o que ele não tem. */
  syncWith(peerId: string): Promise<SyncResult> {
    const running = this.syncing.get(peerId);
    if (running) return running;
    const task = this.doSync(peerId).finally(() => this.syncing.delete(peerId));
    this.syncing.set(peerId, task);
    return task;
  }

  private async doSync(peerId: string): Promise<SyncResult> {
    const peer = this.helper.db.peer(peerId);
    if (!peer || peer.status !== 'paired') return { status: 'skipped', received: 0, sent: 0 };
    if (!peer.cert_fp || !peer.port) return { status: 'skipped', received: 0, sent: 0 };
    if (!this.approved(peer)) return { status: 'approval_required', received: 0, sent: 0 };
    const run = this.helper.db.startRun(peerId, 'out');
    let received = 0;
    let sent = 0;
    try {
      let remoteVv: VersionVector = {};
      for (;;) {
        const page = (await this.signedJson(
          peer,
          'POST',
          '/v1/sync/pull',
          JSON.stringify({ vv: this.helper.db.versionVector(), limit: PULL_LIMIT }),
        )) as { ops: Op[]; more: boolean; vv: VersionVector };
        received += this.helper.insertOps(page.ops).length;
        remoteVv = page.vv;
        if (!page.more || !page.ops.length) break;
      }
      const outgoing = this.helper.db.opsSince(remoteVv).ops;
      for (let i = 0; i < outgoing.length; i += PULL_LIMIT) {
        const batch = outgoing.slice(i, i + PULL_LIMIT);
        await this.signedJson(peer, 'POST', '/v1/sync/push', JSON.stringify({ ops: batch }));
        this.helper.db.markForwarded(batch);
        sent += batch.length;
      }
      // depois do pull + push, o par tem o que tinha mais tudo o que foi enviado
      this.helper.db.noteKnown(peerId, mergeVersionVectors(remoteVv, vvOf(outgoing)));
      this.helper.db.finishRun(run, { received, sent, status: 'ok' });
      this.helper.db.updatePeer(peerId, { last_sync_at: new Date().toISOString() });
      if (received) {
        this.helper.emit('changed');
        this.helper.emit('ops', received);
      }
      this.helper.emit('peers');
      return { status: 'ok', received, sent };
    } catch (e) {
      const code =
        e instanceof HttpError || e instanceof ForeignUserError ? e.code : (e as Error).message;
      this.helper.db.finishRun(run, {
        received,
        sent,
        status: code === 'approval_required' ? 'approval_required' : 'error',
        error: code,
      });
      this.helper.emit('peers');
      return {
        status: code === 'approval_required' ? 'approval_required' : 'error',
        received,
        sent,
        error: code,
      };
    }
  }

  /** Atualiza o endereço de um par descoberto na rede (mDNS). */
  seen(peerId: string, addresses: string[], port: number) {
    const peer = this.helper.db.peer(peerId);
    if (!peer || peer.status !== 'paired') return false;
    this.helper.db.updatePeer(peerId, { addresses, port, last_seen_at: new Date().toISOString() });
    return true;
  }
}

export interface SyncResult {
  status: 'ok' | 'error' | 'skipped' | 'approval_required';
  received: number;
  sent: number;
  error?: string;
}

/** Certificado de um PEM (exportado para testes). */
export const certOf = (pem: string) => new X509Certificate(pem);
