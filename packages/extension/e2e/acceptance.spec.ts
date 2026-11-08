/**
 * Critérios de aceite do MVP Chrome (PRD §18). Um teste por critério.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, launchWithExtension, openLibrary, serviceWorker, test } from './fixtures';
import { openPlayer, routeSoundCloud, setTrack } from './soundcloud-fixture';

const URNS = { '/fixture-artist/deep-groove': '111', '/other/next-one': '222' };

/** Lê uma tabela do IndexedDB da extensão pelo service worker. */
async function readTable<T>(sw: Worker, table: string): Promise<T[]> {
  return sw.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('cuepoint');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction(name, 'readonly');
          const all = tx.objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result as T[]);
          all.onerror = () => reject(all.error);
        };
      }),
    table,
  );
}

async function createResearchInWidget(page: Page, name: string) {
  await page.getByTestId('cuepoint-research').selectOption('__new__');
  await page.getByTestId('cuepoint-new-research').fill(name);
  await page.getByRole('button', { name: 'Criar pesquisa' }).click();
  await expect(page.getByTestId('cuepoint-research').locator('option:checked')).toHaveText(name);
}

async function player(context: BrowserContext) {
  await routeSoundCloud(context, URNS);
  return openPlayer(context);
}

test('1. o usuário cria uma pesquisa', async ({ context }) => {
  const lib = await openLibrary(context);
  await lib.getByLabel('Nome da pesquisa').fill('Latin Bass');
  await lib.getByRole('button', { name: 'Criar pesquisa' }).click();
  await expect(lib.getByTestId('research-list')).toContainText('Latin Bass');
  const page = await player(context);
  await expect(page.getByTestId('cuepoint-research')).toContainText('Latin Bass');
});

test('2. o sistema identifica a faixa em reprodução no SoundCloud', async ({ context }) => {
  const page = await player(context);
  await expect(page.getByTestId('cuepoint-title')).toHaveText('Deep Groove');
  await expect(page.getByTestId('cuepoint-artist')).toHaveText('Fixture Artist');
  await setTrack(page, { href: '/other/next-one', title: 'Next One', artist: 'Other' });
  await expect(page.getByTestId('cuepoint-title')).toHaveText('Next One');
});

test('3 e 5. aprova com um toque e grava true (booleano), com baixa latência', async ({
  context,
}) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Latin Bass');
  const sw = await serviceWorker(context);
  const started = Date.now();
  await page.getByTestId('cuepoint-approve').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  const uiMs = Date.now() - started;
  await expect
    .poll(async () => (await readTable<{ decision: unknown }>(sw, 'decisions')).length)
    .toBe(1);
  const persistedMs = Date.now() - started;
  const [d] = await readTable<{ decision: unknown }>(sw, 'decisions');
  expect(d!.decision).toBe(true);
  expect(typeof d!.decision).toBe('boolean');
  test.info().annotations.push({
    type: 'latência',
    description: `interface ${uiMs} ms · gravado ${persistedMs} ms`,
  });
  console.log(`[latência] interface ${uiMs} ms · gravado no IndexedDB ${persistedMs} ms`);
  expect(persistedMs).toBeLessThan(1500);
});

test('4 e 5. rejeita com um toque, sem confirmação, e grava false', async ({ context }) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Latin Bass');
  await page.getByTestId('cuepoint-reject').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');
  await expect(page.getByTestId('cuepoint-picker')).toHaveCount(0);
  const sw = await serviceWorker(context);
  await expect
    .poll(async () => (await readTable<{ decision: unknown }>(sw, 'decisions'))[0]?.decision)
    .toBe(false);
});

test('6. a mesma faixa tem decisões diferentes em pesquisas diferentes', async ({ context }) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Latin Bass');
  await page.getByTestId('cuepoint-approve').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await createResearchInWidget(page, 'Techno Groovy');
  await page.getByTestId('cuepoint-reject').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');
  const sw = await serviceWorker(context);
  const decisions = await readTable<{ decision: boolean; deleted_at: string | null }>(
    sw,
    'decisions',
  );
  expect(decisions.map((d) => d.decision).sort()).toEqual([false, true]);
});

test('7. uma faixa aprovada recebe várias categorias', async ({ context }) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Peak Time');
  await page.getByTestId('cuepoint-approve').click();
  for (const name of ['Vocal', 'Groovy', 'Drop']) {
    await page.getByTestId('cuepoint-new-category').fill(name);
    await page.getByTestId('cuepoint-new-category').press('Enter');
  }
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('3 categoria(s)');
});

test('8. a faixa pode ser aprovada sem categoria', async ({ context }) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Peak Time');
  await page.getByTestId('cuepoint-approve').click();
  await page.getByTestId('cuepoint-picker-close').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  const lib = await openLibrary(context);
  await expect(lib.getByTestId('count-pending')).toHaveText('1');
});

test('9. a biblioteca mantém as informações após fechar e reabrir o navegador', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuepoint-accept-'));
  let context = await launchWithExtension(dir);
  let page = await player(context);
  await createResearchInWidget(page, 'Latin Bass');
  await page.getByTestId('cuepoint-approve').click();
  await page.getByTestId('cuepoint-new-category').fill('Vocal');
  await page.getByTestId('cuepoint-new-category').press('Enter');
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('1 categoria(s)');
  await context.close();

  context = await launchWithExtension(dir);
  const lib = await openLibrary(context);
  await expect(lib.getByTestId('count-approved')).toHaveText('1');
  page = await player(context);
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('1 categoria(s)');
  await context.close();
});

test('10. o usuário consulta e filtra suas músicas', async ({ context }) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Latin Bass');
  await page.getByTestId('cuepoint-approve').click();
  await page.getByTestId('cuepoint-new-category').fill('Vocal');
  await page.getByTestId('cuepoint-new-category').press('Enter');
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('1 categoria(s)');
  await setTrack(page, { href: '/other/next-one', title: 'Next One', artist: 'Other' });
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Não avaliada');
  await page.getByTestId('cuepoint-approve').click();
  await page.getByTestId('cuepoint-picker-close').click();

  const lib = await openLibrary(context, '/tracks');
  await expect(lib.getByTestId('track-row')).toHaveCount(2);
  await lib.getByLabel('Buscar').fill('next');
  await expect(lib.getByTestId('track-row')).toHaveCount(1);
  await lib.getByLabel('Buscar').fill('');
  await lib.getByRole('button', { name: 'Vocal' }).click();
  await expect(lib.getByTestId('track-row')).toHaveCount(1);
  await expect(lib.getByTestId('track-row')).toContainText('Deep Groove');
});

test('11. o usuário cria e gerencia playlists internas', async ({ context }) => {
  const page = await player(context);
  await createResearchInWidget(page, 'Latin Bass');
  await page.getByTestId('cuepoint-approve').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');

  const lib = await openLibrary(context, '/playlists');
  await lib.getByLabel('Nome da playlist').fill('Manual');
  await lib.getByRole('button', { name: 'Criar playlist' }).click();
  await lib.getByRole('link', { name: /Manual/ }).click();
  await lib.getByLabel('Adicionar música').fill('deep');
  await lib.getByRole('button', { name: /Deep Groove/ }).click();
  await expect(lib.getByTestId('playlist-item')).toHaveCount(1);
  await lib.getByRole('button', { name: 'Remover da playlist' }).click();
  await expect(lib.getByTestId('empty-state')).toBeVisible();
  await lib.getByTestId('delete-playlist').click();
  await lib.getByTestId('delete-playlist-confirm').click();
  await expect(lib.getByRole('heading', { name: 'Playlists' })).toBeVisible();
  await expect(lib.getByTestId('empty-state')).toBeVisible();
});

test('12. as operações essenciais não dependem de servidor externo', async ({ context }) => {
  const external: string[] = [];
  context.on('request', (req) => {
    const url = req.url();
    if (!/^(chrome-extension|data|blob):/.test(url) && !url.startsWith('https://soundcloud.com/')) {
      external.push(url);
    }
  });
  // Sem internet: só a página do SoundCloud (fixture) responde; a resolução de URN falha.
  await context.route('https://soundcloud.com/fixture-artist/deep-groove', (r) => r.abort());
  await routeSoundCloud(context);
  const page = await openPlayer(context);
  await createResearchInWidget(page, 'Offline');
  await expect(page.getByTestId('cuepoint-provisional')).toBeVisible();
  await page.getByTestId('cuepoint-approve').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');

  const lib = await openLibrary(context, '/tracks');
  await expect(lib.getByTestId('track-row')).toHaveCount(1);
  await expect(lib.getByTestId('provisional-badge')).toBeVisible();
  // artwork de sndcdn.com é decorativa; fora isso nenhuma requisição externa
  expect(external.filter((u) => !u.includes('sndcdn.com'))).toEqual([]);
});
