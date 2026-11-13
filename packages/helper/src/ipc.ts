import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { userInfo } from 'node:os';
import type { Helper, LocalRequest } from './helper';

/** Pipe por usuário do Windows (o ACL padrão do named pipe já restringe ao usuário). */
export function defaultPipeName(): string {
  const user = userInfo().username.replace(/[^\w.-]/g, '_');
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\cuepoint-helper-${user}`
    : `/tmp/cuepoint-helper-${user}.sock`;
}

/** Quadro do IPC: uma linha JSON por mensagem. */
export interface IpcRequest {
  id: number;
  req: LocalRequest;
}
export type IpcResponse =
  { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string };
export interface IpcEvent {
  event: string;
  data?: unknown;
}

export function lineReader(socket: Socket, onLine: (line: string) => void): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  });
}

/** Servidor IPC local: atende a extensão (via shim) e envia eventos. */
export function startIpcServer(helper: Helper, pipe: string): Promise<Server> {
  const clients = new Set<Socket>();
  const broadcast = (e: IpcEvent) => {
    const line = `${JSON.stringify(e)}\n`;
    for (const c of clients) c.write(line);
  };
  helper.on('ops', (count) => broadcast({ event: 'ops', data: count }));
  helper.on('changed', () => broadcast({ event: 'changed' }));
  helper.on('peers', () => broadcast({ event: 'peers' }));
  helper.on('approval', (peer) => broadcast({ event: 'approval', data: peer }));
  helper.on('sc', (status) => broadcast({ event: 'sc', data: status }));

  const server = createServer((socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
    lineReader(socket, (line) => {
      let msg: IpcRequest;
      try {
        msg = JSON.parse(line) as IpcRequest;
      } catch {
        return;
      }
      helper
        .handleLocal(msg.req)
        .then((data) =>
          socket.write(`${JSON.stringify({ id: msg.id, ok: true, data } satisfies IpcResponse)}\n`),
        )
        .catch((e: unknown) =>
          socket.write(
            `${JSON.stringify({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies IpcResponse)}\n`,
          ),
        );
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => resolve(server));
  });
}

/** Cliente IPC simples (usado pelos testes e por ferramentas de linha de comando). */
export class IpcClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  readonly events: IpcEvent[] = [];

  private constructor(private readonly socket: Socket) {
    lineReader(socket, (line) => {
      const msg = JSON.parse(line) as IpcResponse | IpcEvent;
      if ('event' in msg) {
        this.events.push(msg);
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error));
    });
  }

  static connect(pipe: string): Promise<IpcClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(pipe, () => resolve(new IpcClient(socket)));
      socket.once('error', reject);
    });
  }

  request<T = unknown>(req: LocalRequest): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.write(`${JSON.stringify({ id, req })}\n`);
    });
  }

  close(): void {
    this.socket.end();
  }
}
