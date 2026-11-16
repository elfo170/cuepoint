/* PoC da exportação via Soundiiz (Sprint 17, ver soundiiz-poc.mjs). Não faz parte do serviço. */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  rebuildFromLog,
  soundiizCheck,
  soundiizImportRequest,
  soundiizParseResponse,
  validateOp,
  type EntityRecord,
  type SoundiizPayload,
  type SoundiizPlaylistInput,
  type SoundiizResult,
} from '@cuepoint/core';

interface Options {
  defaultDb: string;
  argv: string[];
  open: (url: string) => void;
}

const HELP = `PoC da exportação via Soundiiz (Sprint 17)

  node packages/helper/scripts/soundiiz-poc.mjs [opções]

Origem das playlists (pode repetir e combinar):
  --list                 lista as playlists da biblioteca (helper.db, só leitura) e sai
  --playlist <nome|id>   playlist da biblioteca
  --json <arquivo>       JSON exportado pelo botão JSON da extensão
  --fixture <nome>       caso de teste montado com faixas reais da biblioteca:
                         todas | um | limite (200) | excesso (201) | vazia |
                         artista-vazio | especiais (limite/excesso repetem faixas
                         em ciclo se a biblioteca tiver menos)
Outras:
  --db <arquivo>         helper.db (padrão: %LOCALAPPDATA%\\CuePoint\\helper.db)
  --split                variante B: "Artista - Música" no título vira artista + título
  --dry-run              mostra o pedido sem enviar
  --force                envia mesmo fora do limite de 1 a 200 (para ver a resposta da API)
  --open                 abre cada link no navegador
  --show <n>             faixas do pedido a mostrar (padrão 5)
`;

const args = (argv: string[], name: string) =>
  argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));

type Rec = EntityRecord & Record<string, unknown>;
interface Library {
  playlists: Rec[];
  tracks: Map<string, Rec>;
  items: Rec[];
}

function loadLibrary(path: string): Library {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare('SELECT json FROM ops').all() as { json: string }[];
    const { records } = rebuildFromLog(rows.map((r) => validateOp(JSON.parse(r.json))));
    const of = (type: string) =>
      [...records.entries()].filter(([k]) => k.startsWith(`${type}:`)).map(([, r]) => r as Rec);
    return {
      playlists: of('playlist').filter((p) => !p.deleted_at),
      tracks: new Map(of('track').map((t) => [t.id, t])),
      items: of('playlist_track').filter((i) => !i.deleted_at),
    };
  } finally {
    db.close();
  }
}

/** Mesma regra da extensão (`Playlists.items`): posição, id; segue `merged_into`. */
function playlistTracks(lib: Library, playlistId: string) {
  const items = lib.items
    .filter((i) => i.playlist_id === playlistId)
    .sort((a, b) => {
      const pa = a.position as string;
      const pb = b.position as string;
      return pa < pb ? -1 : pa > pb ? 1 : a.id.localeCompare(b.id);
    });
  const out: { title: string; artist: string }[] = [];
  for (const item of items) {
    let track = lib.tracks.get(item.track_id as string);
    while (track?.merged_into) track = lib.tracks.get(track.merged_into as string);
    if (track && !track.deleted_at)
      out.push({ title: track.title as string, artist: track.artist as string });
  }
  return out;
}

function fixture(lib: Library, name: string): SoundiizPlaylistInput {
  const all = [...lib.tracks.values()]
    .filter((t) => !t.deleted_at && !t.merged_into)
    .map((t) => ({ title: t.title as string, artist: t.artist as string }))
    .sort((a, b) => `${a.artist}${a.title}`.localeCompare(`${b.artist}${b.title}`, 'pt-BR'));
  if (!all.length) throw new Error('a biblioteca não tem faixas');
  /** As n primeiras; se a biblioteca tiver menos, repete em ciclo (só para testar o limite). */
  const take = (n: number) => Array.from({ length: n }, (_, i) => all[i % all.length]!);
  const named = (label: string, tracks: SoundiizPlaylistInput['tracks']) => ({
    name: `[Teste Soundiiz] ${label}`,
    description: 'Teste da PoC do CuePoint (Sprint 17). Pode ser apagada.',
    tracks,
  });
  switch (name) {
    case 'todas':
      return named(`todas as ${all.length} faixas`, all.slice(0, 200));
    case 'um':
      return named('1 faixa', take(1));
    case 'limite':
      return named('200 faixas', take(200));
    case 'excesso':
      return named('201 faixas', take(201));
    case 'vazia':
      return named('vazia', []);
    case 'artista-vazio':
      return named(
        'artista vazio',
        take(3).map((t) => ({ ...t, artist: '' })),
      );
    case 'especiais': {
      const odd = all.filter((t) => /[^\x20-\x7e]|["&/\\]/.test(`${t.title}${t.artist}`));
      return {
        ...named('Ação & "aspas" / barra — 🎧', odd.slice(0, 10)),
        description:
          'Teste da PoC do CuePoint (Sprint 17).\nCaracteres especiais. Pode ser apagada.',
      };
    }
    default:
      throw new Error(`fixture desconhecida: ${name}`);
  }
}

function fromJson(path: string): SoundiizPlaylistInput {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    name?: string;
    description?: string | null;
    tracks?: { title: string; artist: string }[];
  };
  if (!raw.name || !Array.isArray(raw.tracks))
    throw new Error(`${path}: não parece um JSON exportado pelo CuePoint`);
  return {
    name: raw.name,
    description: raw.description ?? null,
    tracks: raw.tracks.map((t) => ({ title: t.title, artist: t.artist ?? '' })),
  };
}

/** Variante B: "Artista - Música" (hífen, meia-risca ou travessão) vira artista + título. */
const SPLIT = /^(.+?)\s+[-–—]\s+(.+)$/;
function splitVariant(payload: SoundiizPayload): SoundiizPayload {
  return {
    ...payload,
    tracklist: payload.tracklist.map((t) => {
      const m = SPLIT.exec(t.title);
      return m ? { title: m[2]!.trim(), artists: [m[1]!.trim()] } : t;
    }),
  };
}

async function send(payload: SoundiizPayload, url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* não era JSON */
    }
    return {
      result: soundiizParseResponse(res.status, body),
      cors: res.headers.get('access-control-allow-origin'),
      raw: text.slice(0, 300),
    };
  } catch (e) {
    const result: SoundiizResult = {
      ok: false,
      code: 'network',
      status: 0,
      message: e instanceof Error ? e.message : String(e),
    };
    return { result, cors: null, raw: '' };
  }
}

export async function main({ defaultDb, argv, open }: Options) {
  if (argv.includes('--help') || argv.length === 0) {
    console.log(HELP);
    return;
  }
  const dbPath = args(argv, '--db')[0] ?? defaultDb;
  const needsDb =
    argv.includes('--list') || args(argv, '--playlist').length || args(argv, '--fixture').length;
  const lib = needsDb ? loadLibrary(dbPath) : null;

  if (argv.includes('--list')) {
    const rows = lib!.playlists
      .map((p) => ({ id: p.id, name: p.name as string, n: playlistTracks(lib!, p.id).length }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    for (const r of rows) console.log(`${String(r.n).padStart(4)}  ${r.name}  (${r.id})`);
    console.log(`\n${rows.length} playlists, ${lib!.tracks.size} faixas no log.`);
    return;
  }

  const inputs: SoundiizPlaylistInput[] = [];
  for (const key of args(argv, '--playlist')) {
    const p = lib!.playlists.find((x) => x.id === key || x.name === key);
    if (!p) throw new Error(`playlist não encontrada: ${key} (use --list)`);
    inputs.push({
      name: p.name as string,
      description: (p.description as string) ?? null,
      tracks: playlistTracks(lib!, p.id),
    });
  }
  for (const f of args(argv, '--fixture')) inputs.push(fixture(lib!, f));
  for (const j of args(argv, '--json')) inputs.push(fromJson(j));
  if (!inputs.length) throw new Error('nenhuma playlist escolhida (veja --help)');

  const split = argv.includes('--split');
  const show = Number(args(argv, '--show')[0] ?? 5);
  for (const input of inputs) {
    const req = soundiizImportRequest(input);
    const payload = split ? splitVariant(req.payload) : req.payload;
    console.log(
      `\n■ ${payload.title} — ${payload.tracklist.length} faixas${split ? ' (variante B)' : ''}`,
    );
    for (const t of payload.tracklist.slice(0, show))
      console.log(`    ${t.artists?.join(', ') ?? '(sem artista)'} — ${t.title}`);
    if (payload.tracklist.length > show)
      console.log(`    … mais ${payload.tracklist.length - show}`);

    const block = soundiizCheck(payload.tracklist.length);
    if (block && !argv.includes('--force')) {
      console.log(`  bloqueado localmente: ${JSON.stringify(block)} (use --force para enviar)`);
      continue;
    }
    if (argv.includes('--dry-run')) {
      console.log(`  --dry-run: ${JSON.stringify(payload).length} bytes, não enviado`);
      continue;
    }
    const { result, cors, raw } = await send(payload, req.url, req.headers);
    if (result.ok) {
      const exp = new Date(result.expiresAt * 1000).toLocaleString('pt-BR');
      console.log(`  ✔ nbTracks=${result.nbTracks}  expira ${exp}`);
      console.log(`  ${result.shareUrl}`);
      if (argv.includes('--open')) open(result.shareUrl);
    } else {
      console.log(`  ✘ ${result.code} (HTTP ${result.status}): ${result.message ?? raw}`);
    }
    console.log(`  CORS na resposta: ${cors ?? 'nenhum cabeçalho Access-Control-Allow-Origin'}`);
  }
}
