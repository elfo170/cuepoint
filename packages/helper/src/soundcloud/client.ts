import type { Helper } from '../helper';
import type { SecretBox } from '../secrets';
import { waitForCallback, type CallbackWaiter } from './callback';
import {
  API_BASE,
  authorizeUrl,
  pkcePair,
  randomState,
  REDIRECT_URI,
  requestToken,
  ScError,
  type Credentials,
  type FetchLike,
  type TokenSet,
} from './oauth';

/** Chave (meta do helper.db) do cofre cifrado: credenciais do app + tokens deste PC. */
const SECRETS_KEY = 'sc:secrets';
/** Marca não secreta: o acesso caiu e o usuário precisa reconectar. */
const RECONNECT_KEY = 'sc:reconnect';
/** Renova o access token quando faltar menos que isto para expirar. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Esperas depois de um 429 antes de desistir. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_PAGES = 100;
const TRACK_URN = /^soundcloud:tracks:\d+$/;

interface Vault extends Credentials {
  tokens: TokenSet | null;
}

export type ScState = 'unconfigured' | 'configured' | 'connected' | 'reconnect';

export interface ScStatus {
  state: ScState;
  /** Código do app, parcialmente oculto. */
  clientId: string | null;
  /** Conta conectada (só em memória: nada vindo da API é guardado além do URN). */
  user: { username: string; permalinkUrl: string | null } | null;
  loginPending: boolean;
  lastError: string | null;
  redirectUri: string;
}

/** Faixa enviada pela extensão para exportar. */
export interface ExportTrack {
  urn: string | null;
  url: string | null;
  title: string;
  artist: string;
}

export interface SkippedTrack {
  title: string;
  artist: string;
  reason: 'sem_link' | 'nao_encontrada';
}

export interface DiffTrack {
  urn: string;
  title: string;
  artist: string;
}

export interface ScDiff {
  exists: boolean;
  add: DiffTrack[];
  remove: DiffTrack[];
  /** Mesmas faixas, ordem diferente. */
  reordered: boolean;
  remoteCount: number;
  skipped: SkippedTrack[];
}

export interface ScExportResult {
  urn: string;
  permalinkUrl: string | null;
  trackCount: number;
  skipped: SkippedTrack[];
  /** A lista no SoundCloud ficou igual à enviada (conferida depois de gravar). */
  verified: boolean;
}

export interface SoundCloudOptions {
  box: SecretBox;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Porta do retorno do login (0 nos testes). */
  callbackPort?: number;
  loginTimeoutMs?: number;
}

const mask = (id: string) => (id.length <= 6 ? '••••' : `${id.slice(0, 4)}••••${id.slice(-2)}`);

/**
 * Integração com a API oficial do SoundCloud, no serviço do PC (Sprint 15). Credenciais do app
 * são do usuário (cada pessoa registra o próprio app, exige Artist Pro) e ficam cifradas com o
 * DPAPI. Os tokens são deste PC. Só ações iniciadas pelo usuário chamam a API.
 */
export class SoundCloud {
  private vault: Vault | null | undefined; // undefined = ainda não carregado
  private user: ScStatus['user'] = null;
  private lastError: string | null = null;
  private waiter: CallbackWaiter | null = null;
  private refreshing: Promise<TokenSet> | null = null;
  /** link → URN resolvidos nesta execução (evita repetir /resolve entre diff e exportação). */
  private resolved = new Map<string, string | null>();
  private readonly fetchFn: FetchLike;

  constructor(
    private readonly helper: Helper,
    private readonly opts: SoundCloudOptions,
  ) {
    this.fetchFn = opts.fetch ?? fetch;
    const h = helper;
    h.register('sc:status', () => this.status());
    h.register('sc:configure', (r) => this.configure(String(r.clientId), String(r.clientSecret)));
    h.register('sc:forget', () => this.forget());
    h.register('sc:login', () => this.login());
    h.register('sc:logout', () => this.logout());
    h.register('sc:diff', (r) =>
      this.diff(String(r.playlistUrn), (r.tracks as ExportTrack[]) ?? []),
    );
    h.register('sc:export', (r) =>
      this.export({
        playlistUrn: r.playlistUrn ? String(r.playlistUrn) : null,
        title: String(r.title ?? ''),
        description: String(r.description ?? ''),
        sharing: r.sharing === 'public' ? 'public' : 'private',
        tracks: (r.tracks as ExportTrack[]) ?? [],
      }),
    );
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  private sleep(ms: number) {
    return this.opts.sleep?.(ms) ?? new Promise<void>((r) => setTimeout(r, ms));
  }

  // ------------------------------------------------------------------ cofre

  private async load(): Promise<Vault | null> {
    if (this.vault !== undefined) return this.vault;
    const sealed = this.helper.db.getMeta(SECRETS_KEY);
    this.vault = sealed ? (JSON.parse(await this.opts.box.open(sealed)) as Vault) : null;
    return this.vault;
  }

  private async save(vault: Vault | null): Promise<void> {
    if (vault) this.helper.db.setMeta(SECRETS_KEY, await this.opts.box.seal(JSON.stringify(vault)));
    else this.helper.db.deleteMeta(SECRETS_KEY);
    this.vault = vault;
  }

  private setReconnect(on: boolean) {
    if (on) this.helper.db.setMeta(RECONNECT_KEY, '1');
    else this.helper.db.deleteMeta(RECONNECT_KEY);
  }

  private notify() {
    void this.status().then((s) => this.helper.emit('sc', s));
  }

  // ------------------------------------------------------------------ estado

  async status(): Promise<ScStatus> {
    const v = await this.load();
    let state: ScState = !v
      ? 'unconfigured'
      : v.tokens
        ? 'connected'
        : this.helper.db.getMeta(RECONNECT_KEY)
          ? 'reconnect'
          : 'configured';
    if (state === 'connected' && !this.user) {
      try {
        await this.loadMe();
      } catch (e) {
        if (e instanceof ScError && e.code === 'reconnect') state = 'reconnect';
        else this.lastError = (e as Error).message;
      }
    }
    return {
      state,
      clientId: v ? mask(v.clientId) : null,
      user: state === 'connected' ? this.user : null,
      loginPending: !!this.waiter,
      lastError: this.lastError,
      redirectUri: REDIRECT_URI,
    };
  }

  /** Salva as credenciais do app depois de validá-las com uma troca `client_credentials`. */
  async configure(clientId: string, clientSecret: string): Promise<ScStatus> {
    const creds = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
    if (!creds.clientId || !creds.clientSecret)
      throw new ScError('invalid_client', 'Informe o código e a senha do app.');
    await requestToken(this.fetchFn, creds, { grant_type: 'client_credentials' }, this.now());
    const current = await this.load();
    const sameApp = current?.clientId === creds.clientId;
    await this.save({ ...creds, tokens: sameApp ? (current?.tokens ?? null) : null });
    if (!sameApp) {
      this.user = null;
      this.setReconnect(false);
    }
    this.lastError = null;
    this.notify();
    return this.status();
  }

  /** Desconecta e apaga credenciais e tokens deste PC. */
  async forget(): Promise<ScStatus> {
    await this.logout().catch(() => undefined);
    await this.save(null);
    this.setReconnect(false);
    this.lastError = null;
    this.notify();
    return this.status();
  }

  // ------------------------------------------------------------------ login

  /** Abre o retorno local e devolve a URL de autorização; o resto acontece em segundo plano. */
  async login(): Promise<{ url: string }> {
    const v = await this.load();
    if (!v) throw new ScError('not_configured', 'Informe primeiro o código e a senha do app.');
    await this.waiter?.close();
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const waiter = await waitForCallback({
      state,
      port: this.opts.callbackPort,
      timeoutMs: this.opts.loginTimeoutMs,
    });
    this.waiter = waiter;
    this.lastError = null;
    void waiter.code
      .then(async (code) => {
        const tokens = await requestToken(
          this.fetchFn,
          v,
          {
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
          },
          this.now(),
        );
        await this.save({ ...v, tokens });
        this.setReconnect(false);
        this.user = null;
        await this.loadMe().catch(() => undefined);
      })
      .catch((e: unknown) => {
        this.lastError = (e as Error).message;
      })
      .finally(() => {
        if (this.waiter === waiter) this.waiter = null;
        this.notify();
      });
    return { url: authorizeUrl({ clientId: v.clientId, challenge, state }) };
  }

  /** Revoga os tokens deste app no SoundCloud (melhor esforço) e os apaga daqui. */
  async logout(): Promise<ScStatus> {
    await this.waiter?.close();
    const v = await this.load();
    if (v?.tokens) {
      await this.call('POST', '/disconnect').catch(() => undefined);
      await this.save({ ...v, tokens: null });
    }
    this.user = null;
    this.setReconnect(false);
    this.notify();
    return this.status();
  }

  /** Porta em que o retorno do login está escutando (testes usam porta 0). */
  get callbackPort(): number | null {
    return this.waiter?.port ?? null;
  }

  /** Para o login pendente (ao encerrar o serviço). */
  async close(): Promise<void> {
    await this.waiter?.close();
  }

  // ------------------------------------------------------------------ tokens

  private async accessToken(force = false): Promise<string> {
    const v = await this.load();
    if (!v) throw new ScError('not_configured', 'Informe primeiro o código e a senha do app.');
    if (!v.tokens) {
      throw this.helper.db.getMeta(RECONNECT_KEY)
        ? new ScError('reconnect', 'O acesso ao SoundCloud expirou. Clique em Reconectar.')
        : new ScError('not_connected', 'Entre com o SoundCloud primeiro.');
    }
    if (!force && v.tokens.expiresAt - this.now() > REFRESH_MARGIN_MS) return v.tokens.accessToken;
    // uma renovação por vez: o refresh token é de uso único
    this.refreshing ??= this.refresh(v).finally(() => (this.refreshing = null));
    return (await this.refreshing).accessToken;
  }

  private async refresh(v: Vault): Promise<TokenSet> {
    try {
      if (!v.tokens?.refreshToken)
        throw new ScError('reconnect', 'O acesso ao SoundCloud expirou. Clique em Reconectar.');
      const tokens = await requestToken(
        this.fetchFn,
        v,
        {
          grant_type: 'refresh_token',
          refresh_token: v.tokens.refreshToken,
          redirect_uri: REDIRECT_URI,
        },
        this.now(),
      );
      await this.save({ ...v, tokens: { ...tokens, refreshToken: tokens.refreshToken ?? null } });
      return tokens;
    } catch (e) {
      if (e instanceof ScError && (e.code === 'reconnect' || e.code === 'invalid_client')) {
        // sem repetir em loop: apaga os tokens e espera o usuário reconectar
        await this.save({ ...v, tokens: null });
        this.setReconnect(true);
        this.user = null;
        this.lastError = e.message;
        this.notify();
        throw new ScError('reconnect', e.message);
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------ API

  /**
   * Chamada autenticada (`Authorization: OAuth <token>`). 401 → uma renovação forçada e nova
   * tentativa; 429 → espera crescente (RETRY_DELAYS_MS) e desiste com mensagem clara.
   */
  private async call(
    method: string,
    pathOrUrl: string,
    body?: unknown,
    init: { redirect?: RequestRedirect } = {},
  ): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    let refreshed = false;
    let throttled = 0;
    for (;;) {
      const token = await this.accessToken();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          redirect: init.redirect,
          headers: {
            accept: 'application/json; charset=utf-8',
            authorization: `OAuth ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new ScError('network', 'Sem conexão com o SoundCloud. Verifique a internet.');
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if (res.status === 429) {
        const delay = RETRY_DELAYS_MS[throttled++];
        if (delay === undefined)
          throw new ScError(
            'rate_limited',
            'O SoundCloud pediu para esperar (limite de requisições). Tente de novo em alguns minutos.',
            429,
          );
        await this.sleep(delay);
        continue;
      }
      if (res.status === 401)
        throw new ScError('reconnect', 'O SoundCloud recusou o acesso. Clique em Reconectar.', 401);
      if (res.status === 404) throw new ScError('not_found', 'Não encontrado no SoundCloud.', 404);
      if (res.status >= 400) {
        const text = await res.text().catch(() => '');
        throw new ScError(
          'api',
          `O SoundCloud recusou o pedido (${res.status}). ${text.slice(0, 200)}`.trim(),
          res.status,
        );
      }
      return res;
    }
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.call(method, path, body)).json()) as T;
  }

  private async loadMe() {
    const me = await this.json<{ username?: string; permalink_url?: string }>('GET', '/me');
    this.user = { username: me.username ?? '?', permalinkUrl: me.permalink_url ?? null };
  }

  /** Link de página → URN da faixa (`GET /resolve`, que responde 302 para o recurso). */
  private async resolveUrn(link: string): Promise<string | null> {
    if (this.resolved.has(link)) return this.resolved.get(link)!;
    let urn: string | null = null;
    try {
      const first = await this.call('GET', `/resolve?url=${encodeURIComponent(link)}`, undefined, {
        redirect: 'manual',
      });
      let data: { kind?: string; urn?: string; location?: string } = await first
        .json()
        .catch(() => ({}));
      const location = first.headers.get('location') ?? data.location;
      if (first.status >= 300 && first.status < 400 && location) {
        data = await (await this.call('GET', location)).json();
      }
      urn = data.kind === 'track' && data.urn && TRACK_URN.test(data.urn) ? data.urn : null;
    } catch (e) {
      if (!(e instanceof ScError && e.code === 'not_found')) throw e;
    }
    this.resolved.set(link, urn);
    return urn;
  }

  /** URNs na ordem do CuePoint; faixas sem URN são resolvidas pelo link ou puladas. */
  private async prepare(tracks: ExportTrack[]) {
    const out: DiffTrack[] = [];
    const skipped: SkippedTrack[] = [];
    const seen = new Set<string>();
    for (const t of tracks) {
      let urn = t.urn && TRACK_URN.test(t.urn) ? t.urn : null;
      if (!urn && t.url) urn = await this.resolveUrn(t.url);
      if (!urn) {
        skipped.push({
          title: t.title,
          artist: t.artist,
          reason: t.url ? 'nao_encontrada' : 'sem_link',
        });
        continue;
      }
      if (seen.has(urn)) continue;
      seen.add(urn);
      out.push({ urn, title: t.title, artist: t.artist });
    }
    return { tracks: out, skipped };
  }

  /** Faixas da playlist no SoundCloud, inclusive bloqueadas, seguindo `next_href`. */
  private async remoteTracks(playlistUrn: string): Promise<DiffTrack[]> {
    const out: DiffTrack[] = [];
    let next: string | undefined =
      `/playlists/${encodeURIComponent(playlistUrn)}/tracks?access=playable,preview,blocked&linked_partitioning=true`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const data: {
        collection?: { urn?: string; title?: string; user?: { username?: string } }[];
        next_href?: string | null;
      } = await this.json('GET', next);
      for (const t of data.collection ?? []) {
        if (t.urn) out.push({ urn: t.urn, title: t.title ?? '', artist: t.user?.username ?? '' });
      }
      next = data.next_href ?? undefined;
    }
    return out;
  }

  /** O que muda no SoundCloud ao espelhar a playlist (nada é gravado). */
  async diff(playlistUrn: string, tracks: ExportTrack[]): Promise<ScDiff> {
    const local = await this.prepare(tracks);
    let remote: DiffTrack[];
    try {
      remote = await this.remoteTracks(playlistUrn);
    } catch (e) {
      if (e instanceof ScError && e.code === 'not_found')
        return {
          exists: false,
          add: [],
          remove: [],
          reordered: false,
          remoteCount: 0,
          skipped: local.skipped,
        };
      throw e;
    }
    const localSet = new Set(local.tracks.map((t) => t.urn));
    const remoteSet = new Set(remote.map((t) => t.urn));
    const add = local.tracks.filter((t) => !remoteSet.has(t.urn));
    const remove = remote.filter((t) => !localSet.has(t.urn));
    const common = (list: DiffTrack[], other: Set<string>) =>
      list.filter((t) => other.has(t.urn)).map((t) => t.urn);
    const reordered = common(local.tracks, remoteSet).join() !== common(remote, localSet).join();
    return {
      exists: true,
      add,
      remove,
      reordered,
      remoteCount: remote.length,
      skipped: local.skipped,
    };
  }

  /**
   * Cria a playlist (`POST /playlists`) ou espelha a existente (`PUT /playlists/{urn}`): a lista
   * no SoundCloud passa a ser exatamente a do CuePoint, na mesma ordem. Confere depois de gravar.
   */
  async export(input: {
    playlistUrn: string | null;
    title: string;
    description: string;
    sharing: 'public' | 'private';
    tracks: ExportTrack[];
  }): Promise<ScExportResult> {
    const title = input.title.trim();
    if (!title) throw new ScError('api', 'A playlist precisa de um nome.');
    const local = await this.prepare(input.tracks);
    const playlist = {
      title,
      description: input.description,
      tracks: local.tracks.map((t) => ({ urn: t.urn })),
    };
    const saved = input.playlistUrn
      ? await this.json<{ urn?: string; permalink_url?: string }>(
          'PUT',
          `/playlists/${encodeURIComponent(input.playlistUrn)}`,
          { playlist },
        )
      : await this.json<{ urn?: string; permalink_url?: string }>('POST', '/playlists', {
          playlist: { ...playlist, sharing: input.sharing },
        });
    const urn = saved.urn ?? input.playlistUrn;
    if (!urn) throw new ScError('api', 'O SoundCloud não devolveu o identificador da playlist.');
    const remote = await this.remoteTracks(urn).catch(() => null);
    const verified =
      !!remote && remote.map((t) => t.urn).join() === local.tracks.map((t) => t.urn).join();
    return {
      urn,
      permalinkUrl: saved.permalink_url ?? null,
      trackCount: local.tracks.length,
      skipped: local.skipped,
      verified,
    };
  }
}
