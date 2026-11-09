import type { Server } from 'node:net';
import type { Config } from './config';
import { Helper } from './helper';
import { startIpcServer } from './ipc';
import { Lan } from './lan';

export interface RunningDaemon {
  helper: Helper;
  lan: Lan;
  ipc: Server;
  stop: () => Promise<void>;
}

/** Inicia o serviço: IPC local com a extensão e o servidor HTTPS na LAN. */
export async function startDaemon(config: Config & { mdns?: boolean }): Promise<RunningDaemon> {
  const helper = new Helper({ dataDir: config.dataDir, port: config.port, pipe: config.pipe });
  await helper.start();
  const lan = new Lan(helper);
  const ipc = await startIpcServer(helper, config.pipe);
  await lan.listen();
  helper.portProvider = () => lan.port;
  const stop = async () => {
    await lan.close();
    await new Promise<void>((r) => ipc.close(() => r()));
    helper.close();
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  return { helper, lan, ipc, stop };
}
