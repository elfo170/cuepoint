/**
 * Protocolo de sincronização na LAN (PRD §5) — partes independentes de plataforma.
 * Espelhado em Kotlin (android/core) e validado por spec/vectors/protocol.json.
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 47800;
export const SERVICE_TYPE = 'cuepoint'; // mDNS: _cuepoint._tcp

/** Conteúdo do QR Code / código de pareamento (não transporta a biblioteca, PRD §4.4). */
export interface PairingPayload {
  v: number;
  /** Id do aparelho que mostra o QR. */
  deviceId: string;
  name: string;
  /** Endereços IP candidatos na LAN. */
  addresses: string[];
  port: number;
  /** SHA-256 (hex) da chave pública do certificado TLS (SPKI), para fixar o servidor. */
  certFp: string;
  /** Chave pública de assinatura (SPKI DER em base64). */
  publicKey: string;
  /** Token de uso único. */
  token: string;
}

export function formatPairingUri(p: PairingPayload): string {
  const q = new URLSearchParams({
    v: String(p.v),
    d: p.deviceId,
    n: p.name,
    a: p.addresses.join(','),
    p: String(p.port),
    f: p.certFp,
    k: p.publicKey,
    t: p.token,
  });
  return `cuepoint://pair?${q.toString()}`;
}

export function parsePairingUri(text: string): PairingPayload {
  const trimmed = text.trim();
  if (!trimmed.startsWith('cuepoint://pair?')) throw new Error('Código de pareamento inválido.');
  const q = new URLSearchParams(trimmed.slice('cuepoint://pair?'.length));
  const get = (k: string) => {
    const v = q.get(k);
    if (!v) throw new Error(`Código de pareamento incompleto (${k}).`);
    return v;
  };
  const payload: PairingPayload = {
    v: Number(get('v')),
    deviceId: get('d'),
    name: get('n'),
    addresses: get('a').split(',').filter(Boolean),
    port: Number(get('p')),
    certFp: get('f').toLowerCase(),
    publicKey: get('k'),
    token: get('t'),
  };
  if (payload.v !== PROTOCOL_VERSION) throw new Error('Versão de pareamento não suportada.');
  if (!Number.isInteger(payload.port) || payload.port <= 0) throw new Error('Porta inválida.');
  return payload;
}

/** Texto assinado em cada requisição autenticada. */
export function canonicalRequest(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodySha256Hex: string,
): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodySha256Hex].join('\n');
}

export const SIGNATURE_HEADERS = {
  device: 'x-cuepoint-device',
  timestamp: 'x-cuepoint-timestamp',
  nonce: 'x-cuepoint-nonce',
  signature: 'x-cuepoint-signature',
} as const;

/** Janela aceita para o timestamp das requisições (anti-replay junto com o nonce). */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
  );
}

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return [...(await sha256(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Código de verificação de 6 dígitos exibido nos dois aparelhos durante o pareamento.
 * Derivado do token e das duas chaves públicas (ordenadas), igual nos dois lados.
 */
export async function pairingCode(token: string, keyA: string, keyB: string): Promise<string> {
  const [x, y] = [keyA, keyB].sort();
  const digest = await sha256(new TextEncoder().encode(`${token}|${x}|${y}`));
  const n = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Corpo de /v1/sync/pull e /v1/sync/push. */
export interface PullRequest {
  vv: Record<string, number>;
  limit?: number;
}

export const PULL_LIMIT = 500;
