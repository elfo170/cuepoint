import { EXTENSION_ID, expect, test } from './fixtures';

test('extensão carrega com ID estável e abre a biblioteca', async ({ context, extensionId }) => {
  expect(extensionId).toBe(EXTENSION_ID);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(page.getByRole('heading', { name: 'CuePoint' })).toBeVisible();
});
