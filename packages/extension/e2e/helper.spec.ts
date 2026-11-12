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
// Cada teste usa um perfil novo do navegador (= outro aparelho), então ganha seu próprio serviço.
let dataDir = '';
let pipe = '';
let run = 0;
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
  // Garante que o serviço instalado é o código atual.
  execFileSync(process.execPath, [join(root, 'packages/helper/scripts/build.mjs')]);
});

test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cuepoint-e2e-helper-'));
  pipe = `\\\\.\\pipe\\cuepoint-e2e-${process.pid}-${run++}`;
  ps('install-helper.ps1', [
    '-Browser',
    'Chromium',
    '-NoAutostart',
    '-DataDir',
    dataDir,
    // programa instalado numa pasta temporária: o teste não deixa nada em %LOCALAPPDATA%
    '-AppDir',
    join(dataDir, 'app'),
    '-Pipe',
    pipe,
    '-Port',
    '0',
  ]);
});

test.afterEach(() => {
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

test('pareamento pela biblioteca: QR, código de verificação, confirmação e sync', async ({
  context,
}) => {
  const { Helper } = await import('../../helper/src/helper');
  const { Lan } = await import('../../helper/src/lan');
  const other = new Helper({
    dataDir: mkdtempSync(join(tmpdir(), 'cuepoint-e2e-peer-')),
    port: 0,
    pipe: 'unused',
  });
  await other.start();
  const otherLan = new Lan(other, () => ['127.0.0.1']);
  await otherLan.listen();
  try {
    const lib = await openLibrary(context, '/devices');
    await expect(lib.getByTestId('helper-state')).toHaveText('conectado', { timeout: 20_000 });
    // isolamento por usuário: o outro aparelho precisa ser do mesmo usuário deste PC
    await other.handleLocal({
      type: 'hello',
      deviceId: 'dddddddd-0000-4000-8000-00000000000d',
      userId: JSON.parse(helperCli(['status', '--pipe', pipe])).identity.userId,
      deviceName: 'Outro aparelho',
    });
    await lib.getByRole('link', { name: 'Pesquisas' }).click();
    await lib.getByLabel('Nome da pesquisa').fill('Do PC');
    await lib.getByRole('button', { name: 'Criar pesquisa' }).click();
    await lib.getByRole('link', { name: 'Dispositivos' }).click();
    await lib.getByRole('button', { name: 'Adicionar dispositivo' }).click();
    await expect(lib.getByAltText('QR Code de pareamento')).toBeVisible();
    const uri = (await lib.getByTestId('pairing-uri').inputValue()).replace(
      /a=[^&]+/,
      'a=127.0.0.1',
    );

    const joined = (await other.handleLocal({ type: 'pairing:join', uri })) as { sas: string };
    await expect(lib.getByTestId('peer-sas')).toHaveText(joined.sas, { timeout: 10_000 });
    await lib.getByRole('button', { name: 'Confirmar pareamento' }).click();
    await lib.getByLabel('Política de Outro aparelho').selectOption('auto');
    await expect(lib.getByLabel('Política de Outro aparelho')).toHaveValue('auto');

    // o outro aparelho sincroniza e recebe a biblioteca deste PC (após a réplica local receber)
    await expect
      .poll(async () => JSON.parse(helperCli(['status', '--pipe', pipe])).ops as number, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await other.handleLocal({
      type: 'peer:update',
      peerId: JSON.parse(helperCli(['status', '--pipe', pipe])).identity.deviceId,
      policy: 'auto',
    });
    const res = (await other.handleLocal({
      type: 'peer:sync',
      peerId: JSON.parse(helperCli(['status', '--pipe', pipe])).identity.deviceId,
    })) as { status: string; received: number };
    expect(res.status).toBe('ok');
    expect(res.received).toBeGreaterThan(0);
    await expect(lib.getByTestId('peer-row')).toContainText('Última sync:');
  } finally {
    await otherLan.close();
    other.close();
  }
});

test('PC vazio pareia com outro PC e passa a usar a mesma biblioteca (adota o usuário)', async ({
  context,
}) => {
  const { Helper } = await import('../../helper/src/helper');
  const { Lan } = await import('../../helper/src/lan');
  const otherUser = '00000000-0000-4000-8000-0000000000aa';
  const other = new Helper({
    dataDir: mkdtempSync(join(tmpdir(), 'cuepoint-e2e-peer-')),
    port: 0,
    pipe: 'unused',
  });
  await other.start();
  const otherLan = new Lan(other, () => ['127.0.0.1']);
  await otherLan.listen();
  await other.handleLocal({
    type: 'hello',
    deviceId: 'eeeeeeee-0000-4000-8000-00000000000e',
    userId: otherUser,
    deviceName: 'PC principal',
  });
  try {
    const lib = await openLibrary(context, '/devices');
    await expect(lib.getByTestId('helper-state')).toHaveText('conectado', { timeout: 20_000 });
    const { uri } = (await other.handleLocal({ type: 'pairing:create' })) as { uri: string };
    await lib.getByRole('button', { name: 'Parear com outro PC' }).click();
    await lib.getByLabel('Código do outro computador').fill(uri);
    await lib.getByRole('button', { name: 'Parear', exact: true }).click();
    await expect(lib.getByText('passou a usar a mesma biblioteca de PC principal')).toBeVisible();
    expect(JSON.parse(helperCli(['status', '--pipe', pipe])).identity.userId).toBe(otherUser);

    // o que este PC cria agora é do mesmo usuário e chega ao serviço sem ser recusado
    await lib.getByRole('link', { name: 'Pesquisas' }).click();
    await lib.getByLabel('Nome da pesquisa').fill('Criada no PC novo');
    await lib.getByRole('button', { name: 'Criar pesquisa' }).click();
    await expect
      .poll(() => JSON.parse(helperCli(['status', '--pipe', pipe])).ops as number, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await lib.getByRole('link', { name: 'Configurações' }).click();
    await expect(lib.getByText(otherUser)).toBeVisible();
  } finally {
    await otherLan.close();
    other.close();
  }
});
