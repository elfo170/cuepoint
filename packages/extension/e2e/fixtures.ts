import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_PATH = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
export const EXTENSION_ID = 'daaemjinbpmlbffnjbbonliiglbmjjmn';

export async function launchWithExtension(userDataDir?: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir ?? mkdtempSync(join(tmpdir(), 'cuepoint-')), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

export async function serviceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await launchWithExtension();
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const sw = await serviceWorker(context);
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;
