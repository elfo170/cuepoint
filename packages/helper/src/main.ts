import { parseArgs } from './config';
import { startDaemon } from './daemon';
import { IpcClient } from './ipc';
import { runShim } from './shim';
import { spawnDaemon } from './spawn-daemon';

const config = parseArgs(process.argv.slice(2));

if (config.command === 'daemon') {
  startDaemon(config).catch((e: unknown) => {
    console.error('[cuepoint-helper]', e);
    process.exit(1);
  });
} else if (config.command === 'status') {
  IpcClient.connect(config.pipe)
    .then(async (c) => {
      console.log(JSON.stringify(await c.request({ type: 'status' }), null, 2));
      c.close();
    })
    .catch(() => {
      console.log('serviço não está rodando');
      process.exit(1);
    });
} else {
  // Chrome inicia o host; se o serviço não estiver rodando, o shim o inicia com a mesma configuração.
  void runShim({
    pipe: config.pipe,
    spawnDaemon: () =>
      spawnDaemon([
        '--data-dir',
        config.dataDir,
        '--pipe',
        config.pipe,
        '--port',
        String(config.port),
      ]),
  });
}
