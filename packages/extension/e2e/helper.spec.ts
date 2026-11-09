/**
 * E2E com o serviço auxiliar real via Native Messaging (só Windows).
 * Registra o host temporariamente para o Chromium do Playwright (HKCU\Software\Chromium),
 * com pasta de dados e pipe próprios, e remove tudo ao final. Não toca no Chrome do usuário.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, openLibrary, test } from './fixtures';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const dataDir = mkdtempSync(join(tmpdir(), 'cuepoint-e2e-helper-'));
const pipe = `\\\\.\\pipe\\cuepoint-e2e-${process.pid}`;
const ps = (file: string, args: string[]) =>
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', file), ...args],
    {
      encoding: 'utf8',
    },
  );
const helperCli = (args: string[]) =>
  execFileSync(
    process.execPath,
    ['--no-warnings', join(root, 'packages/helper/dist/cuepoint-helper.mjs'), ...args],
    {
      encoding: 'utf8',
    },
  );

test.skip(process.platform !== 'win32', 'Native Messaging testado só no Windows');

test.beforeAll(() => {
  ps('install-helper.ps1', [
    '-Browser',
    'Chromium',
    '-NoAutostart',
    '-DataDir',
    dataDir,
    '-Pipe',
    pipe,
    '-Port',
    '0',
  ]);
});

test.afterAll(() => {
  ps('uninstall-helper.ps1', ['-Browser', 'Chromium']);
  // encerra o serviço iniciado pelo shim deste teste
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*cuepoint-e2e-${process.pid}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ]);
});

test('extensão conecta ao serviço via Native Messaging e replica o log', async ({ context }) => {
  const lib = await openLibrary(context, '/devices');
  await expect(lib.getByTestId('helper-state')).toHaveText('conectado', { timeout: 20_000 });

  await lib.getByRole('link', { name: 'Pesquisas' }).click();
  await lib.getByLabel('Nome da pesquisa').fill('Sincronizada');
  await lib.getByRole('button', { name: 'Criar pesquisa' }).click();
  await expect(lib.getByTestId('research-list')).toContainText('Sincronizada');

  await lib.getByRole('link', { name: 'Dispositivos' }).click();
  await expect
    .poll(async () => JSON.parse(helperCli(['status', '--pipe', pipe])).ops as number, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const status = JSON.parse(helperCli(['status', '--pipe', pipe]));
  expect(status.linked).toBe(true);
  expect(status.dataDir).toBe(dataDir);
});
