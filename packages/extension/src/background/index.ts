import { Curation } from '../data/curation';
import { Store } from '../data/store';
import { CHANGED_MESSAGE, type Request, type Response } from '../shared/messages';
import { BackgroundHandler } from './handler';

const store = new Store();
const curation = new Curation(store);

async function openLibrary(hash?: string) {
  const url = chrome.runtime.getURL(`library.html${hash ? `#${hash}` : ''}`);
  const [existing] = await chrome.tabs
    .query({ url: chrome.runtime.getURL('library.html') + '*' })
    .catch(() => [] as chrome.tabs.Tab[]);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url });
    if (existing.windowId !== undefined)
      await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

const handler = new BackgroundHandler(curation, openLibrary);

/** Avisa abas do SoundCloud e páginas da extensão que os dados mudaram. */
async function broadcastChanged() {
  const tabs = await chrome.tabs.query({ url: 'https://soundcloud.com/*' });
  for (const tab of tabs) {
    if (tab.id !== undefined)
      chrome.tabs.sendMessage(tab.id, { type: CHANGED_MESSAGE }).catch(() => undefined);
  }
  chrome.runtime.sendMessage({ type: CHANGED_MESSAGE }).catch(() => undefined);
}

store.onChange(() => void broadcastChanged());

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handler
    .handle(request)
    .then((data) => {
      if (request.type === 'notifyChanged') void broadcastChanged();
      sendResponse({ ok: true, data } satisfies Response);
    })
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies Response),
    );
  return true; // resposta assíncrona
});

chrome.runtime.onInstalled.addListener(() => {
  void store.init();
});
