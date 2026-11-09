/**
 * Host de Native Messaging (iniciado pelo Chrome via cuepoint-nm.cmd).
 *
 * Converte o protocolo do Chrome (stdin/stdout, quadros com 4 bytes de tamanho little-endian +
 * JSON) para o IPC do serviço (named pipe, uma linha JSON por mensagem). Se o serviço não
 * estiver rodando, inicia-o em segundo plano e tenta de novo.
 */
import { spawn } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { lineReader } from './ipc';

/** Chrome → host: no máximo 64 MB; host → Chrome: no máximo 1 MB por mensagem. */
export const MAX_TO_CHROME = 1024 * 1024;

export function encodeFrame(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  if (json.length > MAX_TO_CHROME)
    throw new Error(`mensagem grande demais para o Chrome (${json.length} bytes)`);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/** Lê quadros de Native Messaging de um stream. */
export function frameReader(input: Readable, onMessage: (msg: unknown) => void): void {
  let buffer = Buffer.alloc(0);
  input.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break;
      const body = buffer.subarray(4, 4 + len).toString('utf8');
      buffer = buffer.subarray(4 + len);
      try {
        onMessage(JSON.parse(body));
      } catch {
        // quadro inválido: ignora
      }
    }
  });
}

function connect(pipe: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection(pipe, () => resolve(s));
    s.once('error', reject);
  });
}

async function connectOrSpawn(pipe: string, spawnDaemon: () => void): Promise<Socket> {
  try {
    return await connect(pipe);
  } catch {
    spawnDaemon();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        return await connect(pipe);
      } catch {
        // ainda subindo
      }
    }
    throw new Error('não foi possível iniciar o serviço do CuePoint');
  }
}

export async function runShim(options: {
  pipe: string;
  input?: Readable;
  output?: Writable;
  spawnDaemon?: () => void;
}): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const spawnDaemon =
    options.spawnDaemon ??
    (() => {
      const child = spawn(process.execPath, [process.argv[1]!, 'daemon'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    });

  let socket: Socket;
  try {
    socket = await connectOrSpawn(options.pipe, spawnDaemon);
  } catch (e) {
    output.write(encodeFrame({ event: 'error', data: (e as Error).message }));
    return;
  }
  lineReader(socket, (line) => {
    try {
      output.write(encodeFrame(JSON.parse(line)));
    } catch (e) {
      // resposta grande demais: devolve erro no lugar
      const id = (JSON.parse(line) as { id?: number }).id;
      output.write(encodeFrame({ id, ok: false, error: (e as Error).message }));
    }
  });
  frameReader(input, (msg) => socket.write(`${JSON.stringify(msg)}\n`));
  // O Chrome fecha o stdin ao encerrar: o host termina junto (o serviço continua rodando).
  const finish = () => {
    socket.end();
    if (output === process.stdout) process.exit(0);
  };
  input.on('end', finish);
  input.on('close', finish);
  socket.on('close', () => {
    if (output === process.stdout) process.exit(0);
  });
}
