/**
 * Protocolo da API do SoundCloud compartilhado entre o serviço do PC (TS) e o app Android
 * (Kotlin, `SoundCloudProtocol`). Só funções puras: quem faz as chamadas é cada plataforma.
 * A paridade é conferida por `spec/vectors/soundcloud.json`. Ver docs/SOUNDCLOUD_API.md.
 */

export const SC_AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
export const SC_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
export const SC_API_BASE = 'https://api.soundcloud.com';
export const SC_CALLBACK_HOST = '127.0.0.1';
export const SC_CALLBACK_PORT = 47801;
/** Endereço de retorno cadastrado no app do SoundCloud (aceito em 11/11/2026), igual no PC e no celular. */
export const SC_REDIRECT_URI = `http://${SC_CALLBACK_HOST}:${SC_CALLBACK_PORT}/callback`;
/** Renova o access token quando faltar menos que isto para expirar. */
export const SC_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Esperas depois de um 429 antes de desistir. */
export const SC_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
export const SC_TRACK_URN = /^soundcloud:tracks:\d+$/;

export interface ScCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ScHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** `encodeURIComponent` sem dependência de plataforma (o Kotlin implementa a mesma regra). */
const enc = (s: string) => encodeURIComponent(s);

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Pedido ao endpoint de token (form-urlencoded).
 *
 * Conferido na API real em 11/11/2026, divergindo da OpenAPI (que põe o app no corpo em todas as
 * trocas): `client_credentials` só aceita o app em **HTTP Basic** (no corpo → 401
 * `invalid_client`); `authorization_code` e `refresh_token` levam `client_id`/`client_secret`
 * **no corpo** (Basic → `invalid_request`).
 */
export function scTokenRequest(
  creds: ScCredentials,
  params: Record<string, string>,
): ScHttpRequest {
  const basic = params.grant_type === 'client_credentials';
  const body = new URLSearchParams({
    ...(basic ? {} : { client_id: creds.clientId, client_secret: creds.clientSecret }),
    ...params,
  });
  const headers: Record<string, string> = {
    accept: 'application/json; charset=utf-8',
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (basic) headers.authorization = `Basic ${base64(`${creds.clientId}:${creds.clientSecret}`)}`;
  return { url: SC_TOKEN_URL, headers, body: body.toString() };
}

/** URL de autorização (authorization code + PKCE S256 + `state`). */
export function scAuthorizeUrl(p: { clientId: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: SC_REDIRECT_URI,
    response_type: 'code',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  return `${SC_AUTHORIZE_URL}?${q.toString()}`;
}

export type ScTokenErrorCode = 'rate_limited' | 'invalid_client' | 'reconnect' | 'api';

/**
 * Classifica uma falha do endpoint de token: `invalid_client` (código/senha do app errados ou app
 * desativado), `reconnect` (refresh token vencido ou já usado), `rate_limited` ou `api`.
 */
export function scTokenErrorCode(status: number, error: string): ScTokenErrorCode {
  if (status === 429) return 'rate_limited';
  if (error === 'invalid_client' || status === 401) return 'invalid_client';
  if (error === 'invalid_grant') return 'reconnect';
  return 'api';
}

/** Caminhos da API usados pelo CuePoint (base `SC_API_BASE`). */
export const scPaths = {
  me: '/me',
  disconnect: '/disconnect',
  playlists: '/playlists',
  playlist: (urn: string) => `/playlists/${enc(urn)}`,
  /** Sem `access`, a API omite as faixas `blocked`; segue-se `next_href` para as próximas páginas. */
  playlistTracks: (urn: string) =>
    `/playlists/${enc(urn)}/tracks?access=playable,preview,blocked&linked_partitioning=true`,
  resolve: (url: string) => `/resolve?url=${enc(url)}`,
};

/**
 * Corpo de `POST /playlists` (com `sharing`) ou `PUT /playlists/{urn}` (sem `sharing`: não muda
 * a visibilidade). A lista enviada substitui a do SoundCloud (conferido em 11/11/2026).
 */
export function scPlaylistBody(p: {
  title: string;
  description: string;
  urns: string[];
  sharing?: 'public' | 'private';
}) {
  return {
    playlist: {
      title: p.title,
      description: p.description,
      tracks: p.urns.map((urn) => ({ urn })),
      ...(p.sharing ? { sharing: p.sharing } : {}),
    },
  };
}

export interface ScTrackDiff<T extends { urn: string }> {
  add: T[];
  remove: T[];
  /** Mesmas faixas em comum, ordem diferente. */
  reordered: boolean;
}

/** O que muda no SoundCloud ao espelhar `local` (ordem do CuePoint) sobre `remote`. */
export function scDiffTracks<T extends { urn: string }>(local: T[], remote: T[]): ScTrackDiff<T> {
  const localSet = new Set(local.map((t) => t.urn));
  const remoteSet = new Set(remote.map((t) => t.urn));
  const common = (list: T[], other: Set<string>) =>
    list.filter((t) => other.has(t.urn)).map((t) => t.urn);
  return {
    add: local.filter((t) => !remoteSet.has(t.urn)),
    remove: remote.filter((t) => !localSet.has(t.urn)),
    reordered: common(local, remoteSet).join() !== common(remote, localSet).join(),
  };
}
