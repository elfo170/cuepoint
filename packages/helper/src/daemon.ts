import type { Server } from 'node:net';
import type { Config } from './config';
import { Helper } from './helper';
import { startIpcServer } from './ipc';

export interface RunningDaemon {
  helper: Helper;
  ipc: Server;
  stop: () => Promise<void>;
}

/** Inicia o serviço: IPC local (e, a partir do pareamento, o servidor na LAN). */
export async function startDaemon(config: Config): Promise<RunningDaemon> {
  const helper = new Helper({ dataDir: config.dataDir, port: config.port, pipe: config.pipe });
  await helper.start();
  const ipc = await startIpcServer(helper, config.pipe);
  const stop = async () => {
    await new Promise<void>((r) => ipc.close(() => r()));
    helper.close();
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  return { helper, ipc, stop };
}
