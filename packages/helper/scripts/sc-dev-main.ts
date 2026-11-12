/* Cenários contra a API real (ver sc-dev.mjs). Não faz parte do serviço distribuído. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Helper } from '../src/helper';
import { PlainBox } from '../src/secrets';
import { SoundCloud, type ExportTrack, type ScStatus } from '../src/soundcloud/client';

interface Options {
  envFile: string;
  argv: string[];
  open: (url: string) => void;
}

const arg = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

type Raw = { json<T>(method: string, path: string, body?: unknown): Promise<T> };

export async function main({ envFile, argv, open }: Options) {
  process.loadEnvFile(envFile);
  const clientId = process.env.SC_CLIENT_ID;
  const clientSecret = process.env.SC_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error('SC_CLIENT_ID e SC_CLIENT_SECRET ausentes no .env');

  const dataDir = mkdtempSync(join(tmpdir(), 'cp-sc-data-'));
  const helper = new Helper({ dataDir, port: 0, pipe: 'unused' });
  // pasta temporária apagada no fim: não precisa de DPAPI
  const sc = new SoundCloud(helper, { box: new PlainBox() });
  const raw = sc as unknown as Raw;
  const report: [string, string][] = [];
  const note = (k: string, v: string) => {
    report.push([k, v]);
    console.log(`• ${k}: ${v}`);
  };
  let playlistUrn: string | null = null;

  try {
    await sc.configure(clientId, clientSecret);
    note('Credenciais (client_credentials)', 'aceitas');

    const connected = new Promise<ScStatus>((resolve, reject) => {
      helper.on('sc', (s) => {
        const st = s as ScStatus;
        if (st.state === 'connected' && st.user) resolve(st);
        else if (!st.loginPending && st.lastError) reject(new Error(st.lastError));
      });
    });
    const { url } = await sc.login();
    console.log(`\nAbra e autorize no navegador (abrindo agora):\n${url}\n`);
    open(url);
    const st = await connected;
    note(
      'Login com retorno em http://127.0.0.1:47801/callback',
      `ok, conectado como @${st.user!.username}`,
    );

    // Faixas próprias do usuário (Artist Pro) como base dos testes.
    const mine = await raw.json<{ collection?: { urn: string; title: string; access?: string }[] }>(
      'GET',
      '/me/tracks?linked_partitioning=true',
    );
    const own = (mine.collection ?? []).slice(0, 3);
    if (own.length < 2)
      throw new Error('são necessárias pelo menos 2 faixas próprias em /me/tracks');
    note('Faixas próprias usadas', own.map((t) => `${t.urn} (${t.access ?? '?'})`).join(', '));
    const tr = (t: { urn: string; title: string }): ExportTrack => ({
      urn: t.urn,
      url: null,
      title: t.title,
      artist: st.user!.username,
    });

    const created = await sc.export({
      playlistUrn: null,
      title: 'CuePoint teste (pode apagar)',
      description: 'Criada pelo script de validação do CuePoint',
      sharing: 'private',
      tracks: own.map(tr),
    });
    playlistUrn = created.urn;
    note('POST /playlists (privada)', `${created.urn}, conferida: ${created.verified}`);

    const reordered = [own[own.length - 1]!, own[0]!];
    const diff = await sc.diff(created.urn, reordered.map(tr));
    note(
      'Diferença antes do PUT',
      `entra ${diff.add.length}, sai ${diff.remove.length}, reordenada: ${diff.reordered}`,
    );
    const put = await sc.export({
      playlistUrn: created.urn,
      title: 'CuePoint teste (pode apagar)',
      description: 'Atualizada pelo script',
      sharing: 'private',
      tracks: reordered.map(tr),
    });
    note(
      'PUT substitui a lista (remove + reordena)?',
      put.verified
        ? 'SIM: a lista ficou exatamente a enviada'
        : 'NÃO: a lista no SoundCloud difere da enviada',
    );

    const extra: [string, string | undefined][] = [
      ['Faixa de outro artista', arg(argv, '--other')],
      ['Faixa blocked', arg(argv, '--blocked')],
    ];
    for (const [label, link] of extra) {
      if (!link) {
        note(label, 'não testada (passe o link)');
        continue;
      }
      const r = await sc.export({
        playlistUrn: created.urn,
        title: 'CuePoint teste (pode apagar)',
        description: '',
        sharing: 'private',
        tracks: [...reordered.map(tr), { urn: null, url: link, title: label, artist: '?' }],
      });
      note(
        label,
        r.skipped.length
          ? `link não resolvido (${r.skipped[0]!.reason})`
          : `aceita: ${r.verified ? 'sim, aparece na playlist' : 'NÃO aparece na playlist'}`,
      );
    }
  } finally {
    if (playlistUrn && !argv.includes('--keep')) {
      await raw
        .json('DELETE', `/playlists/${encodeURIComponent(playlistUrn)}`)
        .then(() => note('DELETE da playlist de teste', 'ok'))
        .catch((e: Error) => note('DELETE da playlist de teste', `falhou: ${e.message}`));
    }
    await sc.logout().catch(() => undefined);
    note('POST /disconnect', 'tokens de teste revogados');
    await sc.close();
    helper.close();
    rmSync(dataDir, { recursive: true, force: true });
    console.log('\n| Item | Resultado |\n|---|---|');
    for (const [k, v] of report) console.log(`| ${k} | ${v} |`);
  }
}
