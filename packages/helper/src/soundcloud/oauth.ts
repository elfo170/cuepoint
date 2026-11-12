import {
  SC_API_BASE,
  SC_AUTHORIZE_URL,
  SC_CALLBACK_HOST,
  SC_CALLBACK_PORT,
  SC_REDIRECT_URI,
  SC_TOKEN_URL,
  scAuthorizeUrl,
  scTokenErrorCode,
  scTokenRequest,
} from '@cuepoint/core';
import { createHash, randomBytes } from 'node:crypto';

/**
 * OAuth 2.1 do SoundCloud (API Guide + OpenAPI `OAuthToken`): authorization code com PKCE (S256).
 * A troca e a renovação exigem `client_secret` mesmo com PKCE ("all clients are confidential").
 * A forma dos pedidos vem do `@cuepoint/core` (a mesma do app Android). Ver docs/SOUNDCLOUD_API.md.
 */
export const AUTHORIZE_URL = SC_AUTHORIZE_URL;
export const TOKEN_URL = SC_TOKEN_URL;
export const API_BASE = SC_API_BASE;
export const CALLBACK_HOST = SC_CALLBACK_HOST;
export const CALLBACK_PORT = SC_CALLBACK_PORT;
/** Endereço de retorno cadastrado no app do SoundCloud (aceito em 11/11/2026). */
export const REDIRECT_URI = SC_REDIRECT_URI;

export type FetchLike = typeof fetch;

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms em que o access token expira. */
  expiresAt: number;
}

/** Erro com código estável e mensagem em linguagem simples (vai para a interface). */
export class ScError extends Error {
  constructor(
    readonly code:
      | 'not_configured'
      | 'not_connected'
      | 'invalid_client'
      | 'reconnect'
      | 'rate_limited'
      | 'network'
      | 'not_found'
      | 'login_pending'
      | 'login_failed'
      | 'port_busy'
      | 'api',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ScError';
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return b64url(randomBytes(16));
}

export const authorizeUrl = scAuthorizeUrl;

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

/**
 * POST no endpoint de token (form-urlencoded). Traduz as falhas para ScError:
 * `invalid_client` (código/senha do app errados ou app desativado), `reconnect`
 * (refresh token vencido ou já usado), `rate_limited` e `network`.
 */
export async function requestToken(
  fetchFn: FetchLike,
  creds: Credentials,
  params: Record<string, string>,
  now = Date.now(),
): Promise<TokenSet> {
  // Basic só em `client_credentials`; nas outras trocas o app vai no corpo (divergência da
  // OpenAPI conferida na API real em 11/11/2026; ver `scTokenRequest` no core).
  const req = scTokenRequest(creds, params);
  let res: Response;
  try {
    res = await fetchFn(req.url, { method: 'POST', headers: req.headers, body: req.body });
  } catch {
    throw new ScError('network', 'Sem conexão com o SoundCloud. Verifique a internet.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && typeof json.access_token === 'string') {
    const ttl = Number(json.expires_in ?? 3600);
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
      expiresAt: now + (Number.isFinite(ttl) ? ttl : 3600) * 1000,
    };
  }
  const error = String(json.error ?? '');
  const code = scTokenErrorCode(res.status, error);
  if (code === 'rate_limited')
    throw new ScError('rate_limited', 'O SoundCloud pediu para esperar. Tente de novo mais tarde.');
  if (code === 'invalid_client')
    throw new ScError(
      'invalid_client',
      'O SoundCloud não aceitou o código e a senha do app. Confira os dois em soundcloud.com/you/apps (o app exige Artist Pro ativo).',
      res.status,
    );
  if (code === 'reconnect')
    throw new ScError(
      'reconnect',
      'O acesso ao SoundCloud expirou. Clique em Reconectar.',
      res.status,
    );
  throw new ScError(
    'api',
    `O SoundCloud recusou o pedido (${res.status}${error ? `: ${error}` : ''}).`,
    res.status,
  );
}
