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

test('popup legível nos temas claro e escuro (#8)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const main = page.locator('main');
  const field = page.getByTestId('popup-new-research');
  const button = page.getByRole('button', { name: 'Abrir biblioteca' });
  const colors = (l: typeof main) =>
    l.evaluate((el) => {
      // fundo efetivo: o primeiro ancestral com fundo não transparente
      let bg = 'rgb(255, 255, 255)';
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
          bg = c;
          break;
        }
      }
      return { color: getComputedStyle(el).color, background: bg };
    });
  // luminância relativa (0 = preto, 1 = branco) de "rgb(...)"/"oklch(...)" via canvas
  const luminance = (css: string) =>
    page.evaluate((c) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const lin = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    }, css);
  const contrast = async (fg: string, bg: string) => {
    const [a, b] = [await luminance(fg), await luminance(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.getByRole('heading', { name: 'CuePoint' })).toBeVisible();
    const m = await colors(main);
    expect((await luminance(m.background)) < 0.1).toBe(scheme === 'dark');
    expect(await contrast(m.color, m.background)).toBeGreaterThan(7);
    const f = await colors(field);
    expect(await contrast(f.color, f.background)).toBeGreaterThan(7);
    // o botão não depende do hover para aparecer: o texto contrasta com o fundo do popup
    const b = await colors(button);
    expect(await contrast(b.color, m.background)).toBeGreaterThan(7);
  }
});
