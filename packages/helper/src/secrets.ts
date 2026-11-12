import { spawn } from 'node:child_process';

/** Cifra/decifra segredos guardados pelo serviço (credenciais e tokens do SoundCloud). */
export interface SecretBox {
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

/** Entropia adicional do DPAPI: o cifrado só abre com este mesmo valor. */
const ENTROPY_B64 = Buffer.from('CuePoint.SoundCloud.v1').toString('base64');

function script(op: 'Protect' | 'Unprotect'): string {
  return [
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd().Trim()',
    '$data = [Convert]::FromBase64String($in)',
    `$entropy = [Convert]::FromBase64String('${ENTROPY_B64}')`,
    `$out = [Security.Cryptography.ProtectedData]::${op}($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
}

function powershell(command: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`DPAPI falhou (${code}): ${err.trim().split('\n')[0] ?? ''}`));
    });
    // os dados vão pelo stdin, nunca pela linha de comando (visível na lista de processos)
    child.stdin.end(input);
  });
}

/**
 * DPAPI do Windows, escopo do usuário atual: só a mesma conta do Windows, nesta máquina,
 * consegue abrir. Usa o PowerShell (sem dependência nativa); lento só ao salvar/carregar.
 */
export class DpapiBox implements SecretBox {
  async seal(plain: string): Promise<string> {
    return powershell(script('Protect'), Buffer.from(plain, 'utf8').toString('base64'));
  }

  async open(sealed: string): Promise<string> {
    const b64 = await powershell(script('Unprotect'), sealed);
    return Buffer.from(b64, 'base64').toString('utf8');
  }
}

/** Sem cifra (testes e plataformas sem DPAPI). */
export class PlainBox implements SecretBox {
  async seal(plain: string): Promise<string> {
    return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`;
  }

  async open(sealed: string): Promise<string> {
    if (!sealed.startsWith('plain:')) throw new Error('segredo em formato desconhecido');
    return Buffer.from(sealed.slice('plain:'.length), 'base64').toString('utf8');
  }
}

export function defaultSecretBox(): SecretBox {
  return process.platform === 'win32' ? new DpapiBox() : new PlainBox();
}
