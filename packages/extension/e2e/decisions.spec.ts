import type { Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, launchWithExtension, test } from './fixtures';
import { openPlayer, routeSoundCloud, setTrack } from './soundcloud-fixture';

const URNS = { '/fixture-artist/deep-groove': '111', '/other/next-one': '222' };

async function createResearch(page: Page, name: string) {
  await page.getByTestId('cuepoint-research').selectOption('__new__');
  await page.getByTestId('cuepoint-new-research').fill(name);
  await page.getByRole('button', { name: 'Criar pesquisa' }).click();
  await expect(page.getByTestId('cuepoint-research').locator('option:checked')).toHaveText(name);
}

test('aprovar abre o seletor; rejeitar é imediato; categorias múltiplas ou nenhuma', async ({
  context,
}) => {
  await routeSoundCloud(context, URNS);
  const page = await openPlayer(context);
  await expect(page.getByTestId('cuepoint-approve')).toBeDisabled(); // sem pesquisa ativa
  await createResearch(page, 'Latin Bass');

  await page.getByTestId('cuepoint-approve').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await expect(page.getByTestId('cuepoint-picker')).toBeVisible();
  // aprovação sem categoria: fecha o seletor sem classificar
  await page.getByTestId('cuepoint-picker-close').click();
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('Sem categoria');

  // várias categorias
  await page.getByTestId('cuepoint-open-picker').click();
  for (const name of ['Vocal', 'Groovy']) {
    await page.getByTestId('cuepoint-new-category').fill(name);
    await page.getByTestId('cuepoint-new-category').press('Enter');
    await expect(page.getByTestId('cuepoint-category').filter({ hasText: name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('2 categoria(s)');

  // rejeição imediata na próxima faixa, sem seletor
  await setTrack(page, { href: '/other/next-one', title: 'Next One', artist: 'Other' });
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Não avaliada');
  await page.getByTestId('cuepoint-reject').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');
  await expect(page.getByTestId('cuepoint-picker')).toHaveCount(0);
});

test('a mesma faixa tem decisões diferentes em pesquisas diferentes', async ({ context }) => {
  await routeSoundCloud(context, URNS);
  const page = await openPlayer(context);
  await createResearch(page, 'Latin Bass');
  await page.getByTestId('cuepoint-approve').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');

  await createResearch(page, 'Techno Groovy');
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Não avaliada');
  await page.getByTestId('cuepoint-reject').click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');

  await page.getByTestId('cuepoint-research').selectOption({ label: 'Latin Bass' });
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
});

test('a biblioteca persiste após fechar e reabrir o navegador', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuepoint-persist-'));
  let context = await launchWithExtension(dir);
  await routeSoundCloud(context, URNS);
  let page = await openPlayer(context);
  await createResearch(page, 'Peak Time');
  await page.getByTestId('cuepoint-approve').click();
  await page.getByTestId('cuepoint-new-category').fill('Vocal');
  await page.getByTestId('cuepoint-new-category').press('Enter');
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('1 categoria(s)');
  await context.close();

  context = await launchWithExtension(dir);
  await routeSoundCloud(context, URNS);
  page = await openPlayer(context);
  await expect(page.getByTestId('cuepoint-research').locator('option:checked')).toHaveText(
    'Peak Time',
  );
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await expect(page.getByTestId('cuepoint-open-picker')).toHaveText('1 categoria(s)');
  await context.close();
});
