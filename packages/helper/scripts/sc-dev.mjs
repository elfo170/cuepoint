// Validação da API do SoundCloud com credenciais reais (só desenvolvimento, Sprint 15).
//
//   npm run sc:dev -- [--other <link de faixa de outro artista>] [--blocked <link>] [--keep]
//
// Lê SC_CLIENT_ID e SC_CLIENT_SECRET do .env da raiz (nunca entram no bundle nem no repo),
// usa uma pasta de dados temporária, pede o login no navegador e roda os cenários
// "A testar" do PLANEJAMENTO.md. Cria uma playlist PRIVADA de teste e a apaga no fim
// (a menos que --keep). Imprime um relatório para docs/SOUNDCLOUD_API.md.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * No PowerShell 5.1, `npm run sc:dev -- --other <link>` perde o `--` e o npm guarda as opções
 * como `npm_config_other` etc. Aceita as duas formas.
 */
function npmFlags() {
  const out = [];
  for (const name of ['other', 'blocked']) {
    const v = process.env[`npm_config_${name}`];
    if (v && v !== 'true' && !process.argv.includes(`--${name}`)) out.push(`--${name}`, v);
  }
  if (process.env.npm_config_keep === 'true' && !process.argv.includes('--keep'))
    out.push('--keep');
  return out;
}
const out = mkdtempSync(join(tmpdir(), 'cp-sc-dev-'));
const outfile = join(out, 'sc-dev.mjs');
await build({
  entryPoints: [resolve(root, 'scripts/sc-dev-main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
try {
  const { main } = await import(pathToFileURL(outfile).href);
  await main({
    envFile: resolve(root, '../../.env'),
    argv: [...process.argv.slice(2), ...npmFlags()],
    open: (url) =>
      spawnSync('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { stdio: 'ignore' }),
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}
