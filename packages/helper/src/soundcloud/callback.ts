import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CALLBACK_HOST, CALLBACK_PORT, ScError } from './oauth';

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const page = (title: string, text: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>CuePoint</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222}
h1{font-size:1.3rem}</style></head><body><h1>${title}</h1><p>${text}</p></body></html>`;

export interface CallbackWaiter {
  /** Código de autorização recebido (ou erro: negado, state errado, tempo esgotado). */
  readonly code: Promise<string>;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Servidor HTTP local que recebe o retorno do login (`/callback?code&state`). Escuta só em
 * 127.0.0.1, fica aberto apenas durante um login e fecha sozinho ao receber o retorno ou
 * depois de `timeoutMs`.
 */
export async function waitForCallback(opts: {
  state: string;
  port?: number;
  timeoutMs?: number;
}): Promise<CallbackWaiter> {
  let settle!: { resolve: (code: string) => void; reject: (e: Error) => void };
  const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  code.catch(() => undefined); // quem chama decide se observa
  let done = false;

  const close = () =>
    new Promise<void>((r) => {
      clearTimeout(timer);
      if (!server.listening) return r();
      server.close(() => r());
      // a página de resposta já saiu com `connection: close`; só as ociosas são cortadas
      server.closeIdleConnections();
    });
  const finish = (err: Error | null, value?: string) => {
    if (done) return;
    done = true;
    if (err) settle.reject(err);
    else settle.resolve(value!);
    void close();
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${CALLBACK_HOST}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const send = (status: number, title: string, text: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(page(title, text));
    };
    const error = url.searchParams.get('error');
    if (error) {
      send(400, 'Login cancelado', 'O SoundCloud não autorizou o CuePoint. Pode fechar esta aba.');
      finish(new ScError('login_failed', 'O login no SoundCloud foi cancelado.'));
      return;
    }
    if (url.searchParams.get('state') !== opts.state) {
      send(400, 'Login inválido', 'Este retorno não corresponde ao login em andamento.');
      return; // não encerra: pode ser uma aba antiga; o login certo ainda pode chegar
    }
    const received = url.searchParams.get('code');
    if (!received) {
      send(400, 'Login inválido', 'O SoundCloud não enviou o código de autorização.');
      finish(new ScError('login_failed', 'O SoundCloud não enviou o código de autorização.'));
      return;
    }
    send(200, 'Conectado', 'O CuePoint recebeu a autorização do SoundCloud. Pode fechar esta aba.');
    finish(null, received);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      reject(
        e.code === 'EADDRINUSE'
          ? new ScError(
              'port_busy',
              `A porta ${opts.port ?? CALLBACK_PORT} do PC está ocupada por outro programa. Feche-o e tente de novo.`,
            )
          : e,
      ),
    );
    server.listen(opts.port ?? CALLBACK_PORT, CALLBACK_HOST, () => resolve());
  });
  const timer = setTimeout(
    () => finish(new ScError('login_failed', 'O login no SoundCloud não foi concluído a tempo.')),
    opts.timeoutMs ?? LOGIN_TIMEOUT_MS,
  );
  return {
    code,
    port: (server.address() as AddressInfo).port,
    close: async () => {
      finish(new ScError('login_failed', 'Login interrompido.'));
      await close();
    },
  };
}
