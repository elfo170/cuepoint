import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Helper } from '../src/helper';
import { DpapiBox, PlainBox } from '../src/secrets';
import { SoundCloud, type ScStatus } from '../src/soundcloud/client';
import { REDIRECT_URI, ScError } from '../src/soundcloud/oauth';

const CLIENT = { clientId: 'app-client-id', clientSecret: 's3cr3t-do-app' };
const urn = (n: number) => `soundcloud:tracks:${n}`;

/** SoundCloud falso: endpoint de token, /me, /resolve, playlists e faixas paginadas. */
function fakeSoundCloud() {
  const calls: { method: string; url: string; body: string | null; auth: string | null }[] = [];
  const s = {
    calls,
    tokenSeq: 0,
    expiresIn: 3600,
    usedRefresh: new Set<string>(),
    /** Respostas forçadas para as próximas chamadas à API (ex.: 429, 401). */
    queue: [] as number[],
    playlists: new Map<string, string[]>(),
    /** link → id da faixa */
    links: new Map<string, number>([['https://soundcloud.com/a/sem-urn', 77]]),
    pageSize: 2,
    revoked: false,
  };
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : null;
    const headers = new Headers(init.headers);
    calls.push({ method, url: url.toString(), body, auth: headers.get('authorization') });

    if (url.href === 'https://secure.soundcloud.com/oauth/token') {
      const p = new URLSearchParams(body ?? '');
      const grant = p.get('grant_type');
      // como a API real (11/11/2026): client_credentials só em Basic; as demais só no corpo
      if (grant === 'client_credentials') {
        const basic = `Basic ${Buffer.from(`${CLIENT.clientId}:${CLIENT.clientSecret}`).toString('base64')}`;
        if (p.has('client_secret') || headers.get('authorization') !== basic)
          return json(401, { error: 'invalid_client' });
        return json(200, { access_token: 'cc', expires_in: 3600 });
      }
      if (headers.get('authorization')) return json(400, { error: 'invalid_request' });
      if (p.get('client_id') !== CLIENT.clientId || p.get('client_secret') !== CLIENT.clientSecret)
        return json(401, { error: 'invalid_client' });
      if (grant === 'refresh_token') {
        const rt = p.get('refresh_token')!;
        if (s.revoked || s.usedRefresh.has(rt)) return json(400, { error: 'invalid_grant' });
        s.usedRefresh.add(rt);
      }
      if (grant === 'authorization_code') {
        const challenge = createHash('sha256').update(p.get('code_verifier')!).digest('base64url');
        if (p.get('code') !== `code-for-${challenge}`) return json(400, { error: 'invalid_grant' });
        if (p.get('redirect_uri') !== REDIRECT_URI) return json(400, { error: 'invalid_grant' });
      }
      s.tokenSeq += 1;
      return json(200, {
        access_token: `at${s.tokenSeq}`,
        refresh_token: `rt${s.tokenSeq}`,
        expires_in: s.expiresIn,
      });
    }

    expect(url.origin).toBe('https://api.soundcloud.com');
    const forced = s.queue.shift();
    if (forced) return json(forced, { error: `forced ${forced}` });
    if (headers.get('authorization') !== `OAuth at${s.tokenSeq}`) return json(401, {});

    const path = decodeURIComponent(url.pathname);
    if (method === 'GET' && path === '/me')
      return json(200, { username: 'dj-teste', permalink_url: 'https://soundcloud.com/dj-teste' });
    if (method === 'POST' && path === '/disconnect') {
      s.revoked = true;
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && path === '/resolve') {
      const id = s.links.get(url.searchParams.get('url')!);
      if (!id) return json(404, { error: 'not found' });
      return json(302, {
        status: '302 - Found',
        location: `https://api.soundcloud.com/tracks/${id}`,
      });
    }
    const track = path.match(/^\/tracks\/(\d+)$/);
    if (method === 'GET' && track)
      return json(200, { kind: 'track', urn: urn(Number(track[1])), title: 't' });
    if (method === 'POST' && path === '/playlists') {
      const p = JSON.parse(body!).playlist;
      const id = `soundcloud:playlists:${s.playlists.size + 1}`;
      s.playlists.set(
        id,
        p.tracks.map((t: { urn: string }) => t.urn),
      );
      return json(201, {
        urn: id,
        permalink_url: `https://soundcloud.com/x/sets/${s.playlists.size}`,
        sharing: p.sharing,
      });
    }
    const pl = path.match(/^\/playlists\/(soundcloud:playlists:\d+)(\/tracks)?$/);
    if (pl) {
      const list = s.playlists.get(pl[1]!);
      if (!list) return json(404, { error: 'not found' });
      if (method === 'PUT' && !pl[2]) {
        s.playlists.set(
          pl[1]!,
          JSON.parse(body!).playlist.tracks.map((t: { urn: string }) => t.urn),
        );
        return json(200, { urn: pl[1], permalink_url: 'https://soundcloud.com/x/sets/1' });
      }
      if (method === 'GET' && pl[2]) {
        expect(url.searchParams.get('access')).toBe('playable,preview,blocked');
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const page = list.slice(offset, offset + s.pageSize);
        const next =
          offset + s.pageSize < list.length
            ? `https://api.soundcloud.com${url.pathname}?access=playable,preview,blocked&linked_partitioning=true&offset=${offset + s.pageSize}`
            : null;
        return json(200, {
          collection: page.map((u) => ({
            urn: u,
            title: `T${u.split(':')[2]}`,
            user: { username: 'a' },
          })),
          next_href: next,
        });
      }
    }
    return json(404, { error: `rota falsa ausente: ${method} ${path}` });
  };
  return { s, fetch: fetchFn as typeof fetch };
}

const helpers: Helper[] = [];
const clients: SoundCloud[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const h of helpers.splice(0)) h.close();
});

function setup(opts: { now?: () => number } = {}) {
  const helper = new Helper({ dataDir: mkdtempSync(join(tmpdir(), 'cp-sc-')), port: 0, pipe: 'x' });
  helpers.push(helper);
  const sc = fakeSoundCloud();
  const sleeps: number[] = [];
  const client = new SoundCloud(helper, {
    box: new PlainBox(),
    fetch: sc.fetch,
    now: opts.now,
    sleep: async (ms) => void sleeps.push(ms),
    callbackPort: 0,
    loginTimeoutMs: 5000,
  });
  clients.push(client);
  const events: ScStatus[] = [];
  helper.on('sc', (st) => events.push(st as ScStatus));
  return { helper, client, sc, sleeps, events };
}

/** Faz o papel do navegador: autoriza e chama o retorno local com o código. */
async function connect(client: SoundCloud, events: ScStatus[]) {
  const { url } = await client.login();
  const q = new URL(url).searchParams;
  expect(q.get('code_challenge_method')).toBe('S256');
  expect(q.get('redirect_uri')).toBe(REDIRECT_URI);
  const res = await fetch(
    `http://127.0.0.1:${client.callbackPort}/callback?code=code-for-${q.get('code_challenge')}&state=${q.get('state')}`,
  );
  expect(res.status).toBe(200);
  await expect.poll(() => events.at(-1)?.state).toBe('connected');
}

describe('SoundCloud: credenciais e login', () => {
  it('valida as credenciais antes de salvar e guarda tudo cifrado', async () => {
    const { helper, client } = setup();
    expect((await client.status()).state).toBe('unconfigured');
    await expect(client.configure(CLIENT.clientId, 'errada')).rejects.toMatchObject({
      code: 'invalid_client',
    });
    expect((await client.status()).state).toBe('unconfigured');
    const st = await client.configure(` ${CLIENT.clientId} `, CLIENT.clientSecret);
    expect(st).toMatchObject({ state: 'configured', clientId: 'app-••••id' });
    const stored = helper.db.getMeta('sc:secrets')!;
    expect(stored).not.toContain(CLIENT.clientSecret);
    expect(stored).not.toContain(CLIENT.clientId);
  });

  it('login com PKCE pelo retorno local e "Conectado como @…"', async () => {
    const { client, events } = setup();
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await connect(client, events);
    expect(await client.status()).toMatchObject({
      state: 'connected',
      user: { username: 'dj-teste' },
      loginPending: false,
    });
  });

  it('retorno com state errado não encerra o login; cancelamento vira erro', async () => {
    const { client, events } = setup();
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await client.login();
    const port = client.callbackPort;
    const bad = await fetch(`http://127.0.0.1:${port}/callback?code=x&state=outro`);
    expect(bad.status).toBe(400);
    expect((await client.status()).loginPending).toBe(true);
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`);
    await expect.poll(() => events.at(-1)?.lastError).toMatch(/cancelado/);
    expect((await client.status()).state).toBe('configured');
  });

  it('desconectar revoga no SoundCloud e apaga os tokens; esquecer apaga as credenciais', async () => {
    const { helper, client, sc, events } = setup();
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await connect(client, events);
    expect((await client.logout()).state).toBe('configured');
    expect(sc.s.revoked).toBe(true);
    expect((await client.forget()).state).toBe('unconfigured');
    expect(helper.db.getMeta('sc:secrets')).toBeUndefined();
  });
});

describe('SoundCloud: tokens e limites', () => {
  it('renova uma única vez para chamadas simultâneas perto do vencimento', async () => {
    let t = 1_000_000;
    const { client, sc, events } = setup({ now: () => t });
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await connect(client, events);
    sc.s.playlists.set('soundcloud:playlists:9', [urn(1)]);
    t += 3600_000 - 60_000; // falta 1 min
    const tracks = [{ urn: urn(1), url: null, title: 'a', artist: 'b' }];
    await Promise.all([
      client.diff('soundcloud:playlists:9', tracks),
      client.diff('soundcloud:playlists:9', tracks),
    ]);
    const refreshes = sc.s.calls.filter((c) => c.body?.includes('grant_type=refresh_token'));
    expect(refreshes).toHaveLength(1);
  });

  it('refresh recusado: estado "reconnect", sem repetir em loop', async () => {
    let t = 1_000_000;
    const { client, sc, events } = setup({ now: () => t });
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await connect(client, events);
    sc.s.revoked = true;
    t += 3600_000;
    await expect(client.diff('soundcloud:playlists:1', [])).rejects.toMatchObject({
      code: 'reconnect',
    });
    await expect(client.diff('soundcloud:playlists:1', [])).rejects.toMatchObject({
      code: 'reconnect',
    });
    expect(sc.s.calls.filter((c) => c.body?.includes('refresh_token'))).toHaveLength(1);
    expect((await client.status()).state).toBe('reconnect');
  });

  it('401 renova e repete; 429 espera 1 s, 2 s, 4 s e desiste com mensagem clara', async () => {
    const { client, sc, sleeps, events } = setup();
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await connect(client, events);
    sc.s.playlists.set('soundcloud:playlists:9', []);
    sc.s.queue.push(401, 429, 429);
    const d = await client.diff('soundcloud:playlists:9', []);
    expect(d.exists).toBe(true);
    expect(sleeps).toEqual([1000, 2000]);
    sc.s.queue.push(429, 429, 429, 429);
    await expect(client.diff('soundcloud:playlists:9', [])).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});

describe('SoundCloud: exportar e espelhar', () => {
  async function connected() {
    const ctx = setup();
    await ctx.client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await connect(ctx.client, ctx.events);
    return ctx;
  }

  it('cria playlist privada, resolve links sem URN e lista as faixas puladas', async () => {
    const { client, sc } = await connected();
    const r = await client.export({
      playlistUrn: null,
      title: 'Set de sábado',
      description: 'feita no CuePoint',
      sharing: 'private',
      tracks: [
        { urn: urn(1), url: null, title: 'Um', artist: 'A' },
        { urn: null, url: 'https://soundcloud.com/a/sem-urn', title: 'Dois', artist: 'B' },
        { urn: null, url: 'https://soundcloud.com/a/sumiu', title: 'Três', artist: 'C' },
        { urn: null, url: null, title: 'Quatro', artist: 'D' },
        { urn: urn(1), url: null, title: 'Um de novo', artist: 'A' },
      ],
    });
    expect(r).toMatchObject({ urn: 'soundcloud:playlists:1', trackCount: 2, verified: true });
    expect(r.skipped).toEqual([
      { title: 'Três', artist: 'C', reason: 'nao_encontrada' },
      { title: 'Quatro', artist: 'D', reason: 'sem_link' },
    ]);
    const post = sc.s.calls.find((c) => c.method === 'POST' && c.url.endsWith('/playlists'))!;
    expect(JSON.parse(post.body!)).toEqual({
      playlist: {
        title: 'Set de sábado',
        description: 'feita no CuePoint',
        sharing: 'private',
        tracks: [{ urn: urn(1) }, { urn: urn(77) }],
      },
    });
  });

  it('mostra o que entra, sai e muda de ordem, e espelha com PUT (paginado)', async () => {
    const { client, sc } = await connected();
    const pl = 'soundcloud:playlists:5';
    sc.s.playlists.set(pl, [urn(1), urn(2), urn(3)]);
    const tracks = [3, 1, 4].map((n) => ({ urn: urn(n), url: null, title: `L${n}`, artist: 'x' }));
    const d = await client.diff(pl, tracks);
    expect(d).toMatchObject({ exists: true, remoteCount: 3, reordered: true });
    expect(d.add.map((t) => t.urn)).toEqual([urn(4)]);
    expect(d.remove.map((t) => t.urn)).toEqual([urn(2)]);
    const r = await client.export({
      playlistUrn: pl,
      title: 'Nome',
      description: '',
      sharing: 'public',
      tracks,
    });
    expect(r.verified).toBe(true);
    expect(sc.s.playlists.get(pl)).toEqual([urn(3), urn(1), urn(4)]);
    const put = sc.s.calls.find((c) => c.method === 'PUT')!;
    expect(JSON.parse(put.body!).playlist.sharing).toBeUndefined(); // atualização não muda a visibilidade
  });

  it('playlist apagada no SoundCloud: diff indica que não existe e o PUT falha com not_found', async () => {
    const { client } = await connected();
    expect((await client.diff('soundcloud:playlists:404', [])).exists).toBe(false);
    await expect(
      client.export({
        playlistUrn: 'soundcloud:playlists:404',
        title: 'X',
        description: '',
        sharing: 'private',
        tracks: [],
      }),
    ).rejects.toBeInstanceOf(ScError);
  });

  it('sem login, exportar explica o que falta', async () => {
    const { client } = setup();
    await expect(client.diff('soundcloud:playlists:1', [])).rejects.toMatchObject({
      code: 'not_configured',
    });
    await client.configure(CLIENT.clientId, CLIENT.clientSecret);
    await expect(client.diff('soundcloud:playlists:1', [])).rejects.toMatchObject({
      code: 'not_connected',
    });
  });
});

describe.runIf(process.platform === 'win32')('DPAPI (Windows)', () => {
  it('cifra e decifra com a conta do Windows', async () => {
    const box = new DpapiBox();
    const sealed = await box.seal('segredo ✓ com acento');
    expect(sealed).not.toContain('segredo');
    expect(await box.open(sealed)).toBe('segredo ✓ com acento');
  });
});
