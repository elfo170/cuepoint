import { createHash, randomBytes } from 'node:crypto';

/**
 * OAuth 2.1 do SoundCloud (API Guide + OpenAPI `OAuthToken`): authorization code com PKCE (S256).
 * A troca e a renovação exigem `client_secret` mesmo com PKCE ("all clients are confidential"),
 * por isso acontecem só no serviço do PC. Ver docs/SOUNDCLOUD_API.md.
 */
export const AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
export const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
export const API_BASE = 'https://api.soundcloud.com';
export const CALLBACK_HOST = '127.0.0.1';
export const CALLBACK_PORT = 47801;
/** Endereço de retorno cadastrado no app do SoundCloud (aceito em 11/11/2026). */
export const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}/callback`;

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

export function authorizeUrl(p: { clientId: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

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
  // Conferido na API real (11/11/2026), divergindo da OpenAPI: `client_credentials` só aceita o app
  // em HTTP Basic (no corpo → 401 invalid_client); `refresh_token` só no corpo (Basic →
  // invalid_request). `authorization_code` segue o API Guide (corpo).
  const basic = params.grant_type === 'client_credentials';
  const body = new URLSearchParams({
    ...(basic ? {} : { client_id: creds.clientId, client_secret: creds.clientSecret }),
    ...params,
  });
  const headers: Record<string, string> = {
    accept: 'application/json; charset=utf-8',
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (basic) {
    headers.authorization = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
  }
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, { method: 'POST', headers, body: body.toString() });
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
  if (res.status === 429)
    throw new ScError('rate_limited', 'O SoundCloud pediu para esperar. Tente de novo mais tarde.');
  const error = String(json.error ?? '');
  if (error === 'invalid_client' || res.status === 401)
    throw new ScError(
      'invalid_client',
      'O SoundCloud não aceitou o código e a senha do app. Confira os dois em soundcloud.com/you/apps (o app exige Artist Pro ativo).',
      res.status,
    );
  if (error === 'invalid_grant')
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
