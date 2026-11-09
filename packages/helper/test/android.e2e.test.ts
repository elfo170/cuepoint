/**
 * E2E Chrome/PC ⇄ Android no emulador (Sprint 13). Requer um emulador ligado com o app de debug
 * instalado. Rodar com:  $env:CUEPOINT_ANDROID_E2E=1; npm run test:android -w @cuepoint/helper
 *
 * O serviço do PC roda neste processo, escutando em 0.0.0.0; o emulador o alcança por 10.0.2.2.
 */
import { Replica } from '@cuepoint/core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Helper } from '../src/helper';
import { Lan } from '../src/lan';

const ADB =
  process.env.ADB ?? join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk/platform-tools/adb.exe');
const PC = 'eeeeeeee-0000-4000-8000-00000000000e';
const USER = 'eeeeeeee-0000-4000-8000-000000000001';
const RESEARCH = 'eeeeeeee-0000-4000-8000-0000000000aa';
const enabled = process.env.CUEPOINT_ANDROID_E2E === '1';

const adb = (...args: string[]) =>
  execFileSync(ADB, args, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dump(): string {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  return adb('shell', 'cat', '/sdcard/ui.xml');
}

async function tap(text: string, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const xml = dump();
    const re = new RegExp(
      `(?:text|content-desc)="${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    );
    const m = re.exec(xml);
    if (m) {
      const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
      adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
      return;
    }
    await sleep(500);
  }
  throw new Error(`não achei "${text}" na tela`);
}

async function waitText(pattern: RegExp, timeout = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pattern.test(dump())) return;
    await sleep(1000);
  }
  throw new Error(`texto ${pattern} não apareceu`);
}

describe.skipIf(!enabled)('Android ⇄ PC (emulador)', () => {
  it('pareia pelo link, confirma no PC e sincroniza nos dois sentidos', async () => {
    const helper = new Helper({
      dataDir: mkdtempSync(join(tmpdir(), 'cp-android-')),
      port: 47810,
      pipe: 'unused',
    });
    await helper.start();
    const lan = new Lan(helper, () => ['10.0.2.2']);
    await lan.listen();
    try {
      await helper.handleLocal({
        type: 'hello',
        deviceId: PC,
        userId: USER,
        deviceName: 'PC de teste',
      });
      // A "extensão" do PC tem uma pesquisa
      const pc = new Replica(PC, USER);
      helper.db.insertOps([
        pc.put('research', RESEARCH, {
          user_id: USER,
          name: 'Pesquisa do PC',
          description: '',
          archived: false,
        }),
      ]);

      const { uri } = (await helper.handleLocal({ type: 'pairing:create' })) as { uri: string };
      adb('shell', 'am', 'force-stop', 'com.elfo170.cuepoint');
      adb('shell', `am start -a android.intent.action.VIEW -d '${uri}' com.elfo170.cuepoint`);

      // O celular apresentou o token: o PC tem um aparelho pendente com o código de verificação
      let peerId = '';
      for (let i = 0; i < 40 && !peerId; i++) {
        peerId = helper.db.peers().find((p) => p.status === 'pending')?.device_id ?? '';
        await sleep(500);
      }
      expect(peerId).not.toBe('');
      const sas = helper.db.peer(peerId)!.sas!;
      await waitText(new RegExp(`text="${sas}"`));

      await helper.handleLocal({ type: 'peer:confirm', peerId });
      await helper.handleLocal({ type: 'peer:update', peerId, policy: 'auto' });
      await tap('Já confirmei no PC');

      await waitText(/Sincronizado: \d+ recebida/, 40_000);
      // PC → celular: a pesquisa chegou
      await tap('Pesquisas');
      await waitText(/text="Pesquisa do PC"/);
      // celular → PC: as operações do celular chegaram ao serviço
      const origins = new Set(helper.db.opsSince({}).ops.map((o) => o.origin));
      expect(origins.has(peerId)).toBe(true);
      expect(origins.has(PC)).toBe(true);
    } finally {
      await lan.close();
      helper.close();
    }
  }, 180_000);
});
