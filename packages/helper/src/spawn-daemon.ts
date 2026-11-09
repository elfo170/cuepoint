import { spawn } from 'node:child_process';

/**
 * Inicia o serviço em segundo plano, independente do processo atual.
 * No Windows, o host de Native Messaging roda dentro do job object do Chrome; um filho comum
 * ficaria preso a ele (e seguraria o fechamento do navegador). Criando o processo via WMI
 * (Win32_Process.Create) ele nasce fora do job.
 */
export function spawnDaemon(args: string[]): void {
  const argv = ['--no-warnings', process.argv[1]!, 'daemon', ...args];
  if (process.platform === 'win32') {
    const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const commandLine = [quote(process.execPath), ...argv.map(quote)].join(' ');
    const ps = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}' } | Out-Null`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }
  spawn(process.execPath, argv, { detached: true, stdio: 'ignore' }).unref();
}
