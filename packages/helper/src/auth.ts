import { canonicalRequest, SIGNATURE_HEADERS, SIGNATURE_WINDOW_MS } from '@cuepoint/core';
import { createHash, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { signText, verifyText } from './identity';

export const sha256HexSync = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');

/** Cabeçalhos de uma requisição assinada (ECDSA P-256, assinatura DER em base64). */
export function signRequest(params: {
  deviceId: string;
  privateKey: KeyObject;
  method: string;
  path: string;
  body: string;
  now?: number;
}): Record<string, string> {
  const timestamp = String(params.now ?? Date.now());
  const nonce = randomBytes(12).toString('base64url');
  const message = canonicalRequest(
    params.method,
    params.path,
    timestamp,
    nonce,
    sha256HexSync(params.body),
  );
  return {
    [SIGNATURE_HEADERS.device]: params.deviceId,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.signature]: signText(params.privateKey, message),
  };
}

/** Guarda os nonces recentes para recusar reenvio da mesma requisição. */
export class NonceCache {
  private seen = new Map<string, number>();

  check(deviceId: string, nonce: string, now: number): boolean {
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    const key = `${deviceId}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, now + 2 * SIGNATURE_WINDOW_MS);
    return true;
  }
}

export type VerifyResult =
  { ok: true; deviceId: string } | { ok: false; status: number; error: string };

/** Verifica a assinatura de uma requisição recebida. */
export function verifyRequest(params: {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  body: string;
  publicKeyOf: (deviceId: string) => string | undefined;
  nonces: NonceCache;
  now?: number;
}): VerifyResult {
  const h = (name: string) => {
    const v = params.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const deviceId = h(SIGNATURE_HEADERS.device);
  const timestamp = h(SIGNATURE_HEADERS.timestamp);
  const nonce = h(SIGNATURE_HEADERS.nonce);
  const signature = h(SIGNATURE_HEADERS.signature);
  if (!deviceId || !timestamp || !nonce || !signature)
    return { ok: false, status: 401, error: 'unsigned' };
  const now = params.now ?? Date.now();
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_WINDOW_MS) {
    return { ok: false, status: 401, error: 'clock_skew' };
  }
  const key = params.publicKeyOf(deviceId);
  if (!key) return { ok: false, status: 403, error: 'unknown_device' };
  const message = canonicalRequest(
    params.method,
    params.path,
    timestamp,
    nonce,
    sha256HexSync(params.body),
  );
  if (!verifyText(key, message, signature))
    return { ok: false, status: 401, error: 'bad_signature' };
  if (!params.nonces.check(deviceId, nonce, now))
    return { ok: false, status: 401, error: 'replay' };
  return { ok: true, deviceId };
}
