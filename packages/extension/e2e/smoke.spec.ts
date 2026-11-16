import { EXTENSION_ID, expect, test } from './fixtures';

test('extensão carrega com ID estável e abre a biblioteca', async ({ context, extensionId }) => {
  expect(extensionId).toBe(EXTENSION_ID);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(page.getByRole('heading', { name: 'Pesquisas' })).toBeVisible();
});

test('créditos e ícone aparecem no menu lateral em todas as telas', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  for (const hash of ['', '/tracks', '/playlists', '/settings']) {
    await page.goto(`chrome-extension://${extensionId}/library.html#${hash}`);
    const credits = page.getByTestId('credits');
    await expect(credits).toContainText('Criado por Maci - @maci.mp3');
    await expect(credits).toContainText('Apoie o projeto - Pix: bookings.maci@gmail.com');
  }
  const icon = page.locator('aside img');
  await expect(icon).toHaveAttribute('src', 'icons/icon48.png');
  expect(await icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(48);
});
