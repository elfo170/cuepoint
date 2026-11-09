import { DEFAULT_PORT } from '@cuepoint/core';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultPipeName } from './ipc';

export interface Config {
  command: 'daemon' | 'nm' | 'status';
  dataDir: string;
  port: number;
  pipe: string;
}

export function defaultDataDir(): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
  return join(base, 'CuePoint');
}

/** Lê argumentos: `daemon|nm|status [--data-dir X] [--port N] [--pipe P]` (+ variáveis CUEPOINT_*). */
export function parseArgs(argv: string[]): Config {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const command = (['daemon', 'nm', 'status'] as const).find((c) => argv.includes(c)) ?? 'nm';
  return {
    command,
    dataDir: get('--data-dir') ?? process.env.CUEPOINT_HOME ?? defaultDataDir(),
    port: Number(get('--port') ?? process.env.CUEPOINT_PORT ?? DEFAULT_PORT),
    pipe: get('--pipe') ?? process.env.CUEPOINT_PIPE ?? defaultPipeName(),
  };
}
