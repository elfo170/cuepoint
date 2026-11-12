import { Curation } from '../data/curation';
import { Store } from '../data/store';
import { CHANGED_MESSAGE, type Request, type Response } from '../shared/messages';
import { BACKUP_ALARM, BackupService, downloadsWriter } from './backup-service';
import { BackgroundHandler } from './handler';
import { HelperLink } from './helper-link';

const store = new Store();
const curation = new Curation(store);
const helper = new HelperLink(store);
// Provisórias daqui cuja definitiva chegou de outro aparelho são associadas na hora.
helper.afterReceive = () => curation.reconcileProvisional();
const HELPER_ALARM = 'cuepoint-helper';

/** Tipos de mensagem que a biblioteca pode repassar ao serviço auxiliar. */
const HELPER_FORWARD = new Set([
  'status',
  'pairing:create',
  'pairing:join',
  'peers:list',
  'peer:update',
  'peer:confirm',
  'peer:revoke',
  'peer:sync',
  'approval:grant',
  'approvals:list',
  'runs:list',
  // SoundCloud (Sprint 15): credenciais e tokens ficam só no serviço do PC
  'sc:status',
  'sc:configure',
  'sc:forget',
  'sc:login',
  'sc:logout',
  'sc:diff',
  'sc:export',
]);

/** Exportar/atualizar resolve links e respeita esperas do SoundCloud: pode demorar. */
const SLOW_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Pareamento com outro PC. Se esta extensão ainda está vazia, avisa o serviço que pode adotar o
 * usuário do outro PC (isolamento por usuário) e adota junto quando ele confirma.
 */
async function joinPairing(req: Record<string, unknown>) {
  await helper.connect();
  const res = await helper.request<{ adoptedUserId?: string | null }>({
    ...req,
    canAdopt: await store.isEmpty(),
  });
  if (res.adoptedUserId && !(await store.adoptUserIfEmpty(res.adoptedUserId))) {
    throw new Error(
      'Este PC registrou alterações durante o pareamento. Apague a biblioteca dele e pareie de novo.',
    );
  }
  return res;
}

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

/** Backups vão para %LOCALAPPDATA%\CuePoint\backups quando o serviço está instalado. */
const backups = new BackupService(store, async (filename, content) => {
  if (helper.connected) {
    await helper.request({ type: 'backup:write', filename, content });
  } else {
    await downloadsWriter(filename, content);
  }
});
const handler = new BackgroundHandler(curation, openLibrary, backups);

/** Avisa abas do SoundCloud e páginas da extensão que os dados mudaram. */
async function broadcastChanged() {
  const tabs = await chrome.tabs.query({ url: 'https://soundcloud.com/*' });
  for (const tab of tabs) {
    if (tab.id !== undefined)
      chrome.tabs.sendMessage(tab.id, { type: CHANGED_MESSAGE }).catch(() => undefined);
  }
  chrome.runtime.sendMessage({ type: CHANGED_MESSAGE }).catch(() => undefined);
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Sincroniza com o serviço auxiliar pouco depois das alterações (agrupa cliques rápidos). */
function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void helper.sync(), delay);
}

helper.onEvent((event, data) => {
  if (event === 'changed' || event === 'ops') scheduleSync(200);
  if (event === 'approval') {
    const peer = data as { device_id: string; name: string };
    chrome.notifications.create(`approval:${peer.device_id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'CuePoint: sincronização pendente',
      message: `${peer.name} quer sincronizar com este computador.`,
      buttons: [{ title: 'Permitir' }],
      requireInteraction: true,
    });
  }
  if (event === 'peers' || event === 'approval' || event === 'sc')
    chrome.runtime.sendMessage({ type: CHANGED_MESSAGE }).catch(() => undefined);
});

chrome.notifications.onButtonClicked.addListener((id) => {
  if (!id.startsWith('approval:')) return;
  void helper
    .request({ type: 'approval:grant', peerId: id.slice('approval:'.length) })
    .catch(console.error);
  chrome.notifications.clear(id);
});

let backupCheck: ReturnType<typeof setTimeout> | undefined;
function onDataChanged() {
  void broadcastChanged();
  clearTimeout(backupCheck);
  backupCheck = setTimeout(() => void backups.onChanges().catch(console.error), 2000);
  scheduleSync();
}
store.onChange(onDataChanged);

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  const reply = (p: Promise<unknown>) =>
    p
      .then((data) => sendResponse({ ok: true, data } satisfies Response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies Response),
      );

  if (request.type === 'helper:status') {
    reply(helper.connect().then(() => helper.status));
    return true;
  }
  if (request.type === 'helper:sync') {
    reply(helper.sync().then(() => helper.status));
    return true;
  }
  if (request.type === 'helper:request') {
    const req = request.req as { type?: string };
    if (!req?.type || !HELPER_FORWARD.has(req.type)) {
      reply(Promise.reject(new Error('operação não permitida')));
      return true;
    }
    if (req.type === 'pairing:join') {
      reply(joinPairing(req as Record<string, unknown>));
      return true;
    }
    const timeout = req.type.startsWith('sc:') ? SLOW_TIMEOUT_MS : undefined;
    reply(helper.connect().then(() => helper.request(req as Record<string, unknown>, timeout)));
    return true;
  }
  reply(
    handler.handle(request).then((data) => {
      if (request.type === 'notifyChanged') {
        void broadcastChanged();
        void backups.onChanges().catch(console.error);
        scheduleSync();
      }
      return data;
    }),
  );
  return true; // resposta assíncrona
});

function startup() {
  void store.init().then(() => backups.schedule());
  void chrome.alarms.create(HELPER_ALARM, { delayInMinutes: 1, periodInMinutes: 5 });
  scheduleSync(500);
}

chrome.runtime.onInstalled.addListener(startup);
chrome.runtime.onStartup.addListener(startup);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BACKUP_ALARM) void backups.run('auto').catch(console.error);
  if (alarm.name === HELPER_ALARM) void helper.sync();
});
