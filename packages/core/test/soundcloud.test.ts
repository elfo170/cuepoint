/**
 * Protocolo do SoundCloud compartilhado (Sprint 16.1). Gera spec/vectors/soundcloud.json, lido
 * também pela suíte Kotlin (`SoundCloudVectorsTest`). Regenerar após mudança intencional:
 * `npm run vectors -w @cuepoint/core`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SC_API_BASE,
  SC_AUTHORIZE_URL,
  SC_CALLBACK_PORT,
  SC_REDIRECT_URI,
  SC_REFRESH_MARGIN_MS,
  SC_RETRY_DELAYS_MS,
  SC_TOKEN_URL,
  SC_TRACK_URN,
  scAuthorizeUrl,
  scDiffTracks,
  scPaths,
  scPlaylistBody,
  scTokenErrorCode,
  scTokenRequest,
} from '../src';

const spec = resolve(__dirname, '../../../spec/vectors/soundcloud.json');
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Credenciais fictícias com caracteres que exigem codificação (o real é alfanumérico). */
const creds = { clientId: 'cl1ent-ID_42', clientSecret: 'S3cr+t/=é ~&x' };

const tokenCases = [
  { name: 'client_credentials (app em HTTP Basic)', params: { grant_type: 'client_credentials' } },
  {
    name: 'authorization_code (app no corpo)',
    params: {
      grant_type: 'authorization_code',
      code: '1-123456-12345678-FAbcfbe9ir2wdj0',
      redirect_uri: SC_REDIRECT_URI,
      code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    },
  },
  {
    name: 'refresh_token (app no corpo, com redirect_uri)',
    params: {
      grant_type: 'refresh_token',
      refresh_token: '1234c331329477150e7b6056ff212345',
      redirect_uri: SC_REDIRECT_URI,
    },
  },
].map((c) => ({ ...c, expected: scTokenRequest(creds, c.params) }));

/** RFC 7636, apêndice B. */
const pkce = {
  verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
};

const authorize = {
  clientId: creds.clientId,
  challenge: pkce.challenge,
  state: 'st/ate+1',
};

const tokenErrors = [
  { status: 429, error: '', code: scTokenErrorCode(429, '') },
  { status: 401, error: '', code: scTokenErrorCode(401, '') },
  { status: 400, error: 'invalid_client', code: scTokenErrorCode(400, 'invalid_client') },
  { status: 400, error: 'invalid_grant', code: scTokenErrorCode(400, 'invalid_grant') },
  { status: 400, error: 'invalid_request', code: scTokenErrorCode(400, 'invalid_request') },
  { status: 500, error: '', code: scTokenErrorCode(500, '') },
];

const PL = 'soundcloud:playlists:1234567';
const LINK = "https://soundcloud.com/artista/faixa-ção?in=x/sets/y&p=a b~!*'()";
const paths = [
  { name: 'me', arg: null, path: scPaths.me },
  { name: 'disconnect', arg: null, path: scPaths.disconnect },
  { name: 'playlists', arg: null, path: scPaths.playlists },
  { name: 'playlist', arg: PL, path: scPaths.playlist(PL) },
  { name: 'playlistTracks', arg: PL, path: scPaths.playlistTracks(PL) },
  { name: 'resolve', arg: LINK, path: scPaths.resolve(LINK) },
];

const t = (n: number) => `soundcloud:tracks:${n}`;
const bodies = [
  { title: 'Techno', description: 'Seleção', urns: [t(1), t(2)], sharing: 'private' as const },
  { title: 'Techno', description: '', urns: [t(2)], sharing: 'public' as const },
  { title: 'Atualizada', description: 'sem sharing (PUT)', urns: [t(3), t(1)] },
  { title: 'Vazia', description: '', urns: [] },
].map((input) => ({ input, body: scPlaylistBody(input) }));

const u = (...ns: number[]) => ns.map((n) => ({ urn: t(n) }));
const diffs = [
  { name: 'igual', local: u(1, 2, 3), remote: u(1, 2, 3) },
  { name: 'entra uma', local: u(1, 2, 3), remote: u(1, 3) },
  { name: 'sai uma', local: u(1, 3), remote: u(1, 2, 3) },
  { name: 'reordena', local: u(3, 1, 2), remote: u(1, 2, 3) },
  { name: 'entra, sai e reordena', local: u(4, 2, 1), remote: u(1, 2, 3) },
  { name: 'remota vazia', local: u(1, 2), remote: [] },
  { name: 'local vazia', local: [], remote: u(1, 2) },
  { name: 'remota com repetida', local: u(1, 2), remote: u(1, 2, 2) },
].map((c) => ({ ...c, expected: scDiffTracks(c.local, c.remote) }));

const trackUrns = [
  { value: 'soundcloud:tracks:123', valid: true },
  { value: 'soundcloud:tracks:', valid: false },
  { value: 'soundcloud:playlists:123', valid: false },
  { value: 'soundcloud:tracks:12a', valid: false },
  { value: ' soundcloud:tracks:1', valid: false },
].map((c) => ({ ...c, valid: SC_TRACK_URN.test(c.value) }));

describe('protocolo do SoundCloud', () => {
  it('spec/vectors/soundcloud.json está atualizado', async () => {
    await expect(
      pretty({
        version: 1,
        description:
          'Protocolo da API do SoundCloud compartilhado entre o serviço do PC (TS) e o app Android (Kotlin). Gerado por packages/core/test/soundcloud.test.ts.',
        constants: {
          authorizeUrl: SC_AUTHORIZE_URL,
          tokenUrl: SC_TOKEN_URL,
          apiBase: SC_API_BASE,
          redirectUri: SC_REDIRECT_URI,
          callbackPort: SC_CALLBACK_PORT,
          refreshMarginMs: SC_REFRESH_MARGIN_MS,
          retryDelaysMs: SC_RETRY_DELAYS_MS,
        },
        credentials: creds,
        tokenRequests: tokenCases,
        pkce,
        authorize: { ...authorize, url: scAuthorizeUrl(authorize) },
        tokenErrors,
        paths,
        playlistBodies: bodies,
        diffs,
        trackUrns,
      }),
    ).toMatchFileSnapshot(spec);
  });

  it('lembrete técnico 1: Basic só em client_credentials; nas outras trocas o app vai no corpo', () => {
    const [cc, code, refresh] = tokenCases.map((c) => c.expected);
    const basic = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`, 'utf8').toString('base64')}`;
    expect(cc!.headers.authorization).toBe(basic);
    expect(new URLSearchParams(cc!.body).has('client_id')).toBe(false);
    expect(new URLSearchParams(cc!.body).has('client_secret')).toBe(false);
    for (const req of [code!, refresh!]) {
      expect(req.headers.authorization).toBeUndefined();
      const body = new URLSearchParams(req.body);
      expect(body.get('client_id')).toBe(creds.clientId);
      expect(body.get('client_secret')).toBe(creds.clientSecret);
      expect(body.get('redirect_uri')).toBe(SC_REDIRECT_URI);
    }
    for (const req of [cc!, code!, refresh!]) {
      expect(req.url).toBe('https://secure.soundcloud.com/oauth/token');
      expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    }
  });

  it('PKCE S256 do vetor confere (RFC 7636)', () => {
    expect(createHash('sha256').update(pkce.verifier).digest('base64url')).toBe(pkce.challenge);
  });

  it('os casos do arquivo valem para as funções do core', () => {
    const file = JSON.parse(readFileSync(spec, 'utf8')) as {
      credentials: typeof creds;
      tokenRequests: typeof tokenCases;
      authorize: typeof authorize & { url: string };
      tokenErrors: typeof tokenErrors;
      diffs: typeof diffs;
    };
    for (const c of file.tokenRequests)
      expect(scTokenRequest(file.credentials, c.params), c.name).toEqual(c.expected);
    expect(scAuthorizeUrl(file.authorize)).toBe(file.authorize.url);
    for (const c of file.tokenErrors) expect(scTokenErrorCode(c.status, c.error)).toBe(c.code);
    for (const c of file.diffs) expect(scDiffTracks(c.local, c.remote), c.name).toEqual(c.expected);
  });

  it('caminhos: URN e link codificados como encodeURIComponent', () => {
    expect(scPaths.playlist(PL)).toBe('/playlists/soundcloud%3Aplaylists%3A1234567');
    expect(scPaths.playlistTracks(PL)).toContain('access=playable,preview,blocked');
    expect(scPaths.resolve(LINK)).toBe(`/resolve?url=${encodeURIComponent(LINK)}`);
  });
});
