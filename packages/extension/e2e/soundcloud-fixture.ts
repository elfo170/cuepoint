import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = resolve(fileURLToPath(new URL('.', import.meta.url)), '../test/fixtures');
const playerHtml = readFileSync(resolve(fixtures, 'soundcloud-player.html'), 'utf8');

/** URN devolvido pela página de cada faixa, por caminho. `null` = página sem URN. */
export type UrnMap = Record<string, string | null>;

/**
 * Intercepta https://soundcloud.com/* e serve as fixtures: a página de playlist (com a barra de
 * reprodução) e as páginas de faixa usadas para resolver o URN.
 */
export async function routeSoundCloud(context: BrowserContext, urns: UrnMap = {}): Promise<void> {
  await context.route('https://soundcloud.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname in urns) {
      const id = urns[url.pathname];
      const meta = id
        ? `<meta property="twitter:app:url:googleplay" content="soundcloud://sounds:${id}">`
        : '';
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head>${meta}</head><body></body></html>`,
      });
    }
    return route.fulfill({ contentType: 'text/html', body: playerHtml });
  });
}

export async function openPlayer(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('https://soundcloud.com/fixture-artist/sets/fixture-set');
  return page;
}

export async function setTrack(
  page: Page,
  t: { href: string; title: string; artist: string },
): Promise<void> {
  await page.evaluate((track) => {
    (window as unknown as { __setTrack: (t: unknown) => void }).__setTrack(track);
  }, t);
}
