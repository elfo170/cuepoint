/**
 * Teste opcional contra o SoundCloud real (não faz parte de `npm run e2e`).
 * Uso: npm run e2e:soundcloud:live -w @cuepoint/extension
 * Variável opcional SOUNDCLOUD_TRACK_URL para escolher a faixa.
 */
import { expect, test } from '../e2e/fixtures';

const TRACK_URL = process.env.SOUNDCLOUD_TRACK_URL ?? 'https://soundcloud.com/forss/flickermood';

test('detecta a faixa tocando no SoundCloud real', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  await page.goto(TRACK_URL);
  // Aceita o banner de cookies, se aparecer
  await page
    .getByRole('button', { name: /accept|aceitar|i agree/i })
    .first()
    .click({ timeout: 10_000 })
    .catch(() => undefined);
  await page.locator('.sound__header .sc-button-play, .playButton').first().click();
  await expect(page.getByTestId('cuepoint-title')).not.toHaveText('Nenhuma faixa tocando', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('cuepoint-provisional')).toHaveCount(0, { timeout: 30_000 });
});
