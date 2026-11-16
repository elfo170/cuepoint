// PoC da exportação via Soundiiz (só desenvolvimento, Sprint 17).
//
//   node packages/helper/scripts/soundiiz-poc.mjs --help
//
// Lê a biblioteca do helper.db SÓ PARA LEITURA (ou um JSON exportado pela extensão), monta o
// pedido com o core (`soundiizImportRequest`) e chama a API pública do Soundiiz, que devolve um
// link temporário (24 h). Nada é gravado na biblioteca. Resultados: docs/SOUNDIIZ_API.md.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'cp-soundiiz-poc-'));
const outfile = join(out, 'soundiiz-poc.mjs');
await build({
  entryPoints: [resolve(root, 'scripts/soundiiz-poc-main.ts')],
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
    defaultDb: join(process.env.LOCALAPPDATA ?? '', 'CuePoint', 'helper.db'),
    argv: process.argv.slice(2),
    open: (url) => spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' }),
  });
} catch (e) {
  console.error(`\nErro: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
