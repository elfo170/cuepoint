import { expect, test } from './fixtures';
import { openPlayer, routeSoundCloud, setTrack } from './soundcloud-fixture';

test('widget mostra a faixa atual e acompanha a troca de faixa', async ({ context }) => {
  await routeSoundCloud(context, { '/fixture-artist/deep-groove': '123456789' });
  const page = await openPlayer(context);

  const widget = page.getByTestId('cuepoint-widget');
  await expect(widget).toBeVisible();
  await expect(page.getByTestId('cuepoint-title')).toHaveText('Deep Groove');
  await expect(page.getByTestId('cuepoint-artist')).toHaveText('Fixture Artist');
  // URN resolvido pela página da faixa: deixa de ser provisória
  await expect(page.getByTestId('cuepoint-provisional')).toHaveCount(0);

  await setTrack(page, { href: '/other/next-one', title: 'Next One', artist: 'Other' });
  await expect(page.getByTestId('cuepoint-title')).toHaveText('Next One');
  // Página sem URN: faixa provisória
  await expect(page.getByTestId('cuepoint-provisional')).toBeVisible();
});

test('widget não cobre a barra de reprodução e pode ser recolhido', async ({ context }) => {
  await routeSoundCloud(context);
  const page = await openPlayer(context);
  const widget = page.getByTestId('cuepoint-widget');
  await expect(widget).toBeVisible();

  const box = (await widget.boundingBox())!;
  const bar = (await page.locator('.playControls').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);

  await page.getByRole('button', { name: 'Minimizar' }).click();
  await expect(widget).toHaveCount(0);
  await page.getByTestId('cuepoint-expand').click();
  await expect(widget).toBeVisible();
});

test('botões usam ícones vetoriais e registram a decisão', async ({ context }) => {
  await routeSoundCloud(context);
  const page = await openPlayer(context);
  const approve = page.getByTestId('cuepoint-approve');
  const reject = page.getByTestId('cuepoint-reject');
  await expect(approve.locator('svg')).toHaveCount(1);
  await expect(reject.locator('svg')).toHaveCount(1);
  await expect(approve).not.toContainText(/SIM|NÃO/i);

  await reject.click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');
  await expect(page.getByTestId('cuepoint-picker')).toHaveCount(0);

  await approve.click();
  await expect(page.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await expect(page.getByTestId('cuepoint-picker')).toBeVisible();
  await page.getByTestId('cuepoint-picker-close').click();
  await expect(page.getByTestId('cuepoint-picker')).toHaveCount(0);
});
