import type { Server } from 'node:net';
import type { Config } from './config';
import { Discovery } from './discovery';
import { Helper } from './helper';
import { startIpcServer } from './ipc';
import { Lan } from './lan';
import { defaultSecretBox } from './secrets';
import { SoundCloud } from './soundcloud/client';

export interface RunningDaemon {
  helper: Helper;
  lan: Lan;
  soundcloud: SoundCloud;
  ipc: Server;
  stop: () => Promise<void>;
}

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Inicia o serviço: IPC local com a extensão, servidor HTTPS na LAN, descoberta mDNS e o
 * agendador de sincronização com os outros serviços pareados (PC ⇄ PC).
 */
export async function startDaemon(config: Config & { mdns?: boolean }): Promise<RunningDaemon> {
  const helper = new Helper({ dataDir: config.dataDir, port: config.port, pipe: config.pipe });
  await helper.start();
  const lan = new Lan(helper);
  // só chama a API quando o usuário pede (exportar, entrar, desconectar)
  const soundcloud = new SoundCloud(helper, { box: defaultSecretBox() });
  const ipc = await startIpcServer(helper, config.pipe);
  await lan.listen();
  helper.portProvider = () => lan.port;

  const discovery = new Discovery();
  const syncAll = () => {
    for (const p of helper.db.peers())
      if (p.status === 'paired' && p.cert_fp) void lan.syncWith(p.device_id);
  };
  let started = false;
  const startDiscovery = () => {
    const id = helper.identity;
    if (started || !id || config.mdns === false) return;
    started = true;
    discovery.start({
      deviceId: id.deviceId,
      name: id.name,
      port: lan.port,
      onFound: (d) => {
        if (lan.seen(d.deviceId, d.addresses, d.port)) void lan.syncWith(d.deviceId);
      },
    });
  };
  startDiscovery();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  helper.on('changed', () => {
    startDiscovery();
    clearTimeout(debounce);
    debounce = setTimeout(syncAll, 3000);
  });
  const timer = setInterval(syncAll, SYNC_INTERVAL_MS);

  const stop = async () => {
    clearInterval(timer);
    clearTimeout(debounce);
    discovery.stop();
    await soundcloud.close();
    await lan.close();
    await new Promise<void>((r) => ipc.close(() => r()));
    helper.close();
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  return { helper, lan, soundcloud, ipc, stop };
}
