import { Replica } from '@cuepoint/core';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { startDaemon, type RunningDaemon } from '../src/daemon';
import { HelperDb } from '../src/db';
import { IpcClient } from '../src/ipc';
import { encodeFrame, frameReader, runShim } from '../src/shim';

const USER = '00000000-0000-4000-8000-000000000001';
const PC = 'aaaaaaaa-0000-4000-8000-00000000000a';
let seq = 0;
const tmp = () => mkdtempSync(join(tmpdir(), 'cuepoint-helper-'));
const pipeName = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\cuepoint-test-${process.pid}-${seq++}`
    : join(tmp(), 'p.sock');

const running: RunningDaemon[] = [];
afterEach(async () => {
  while (running.length) await running.pop()!.stop();
});

async function daemon(dataDir = tmp()) {
  const d = await startDaemon({ command: 'daemon', dataDir, port: 0, pipe: pipeName() });
  running.push(d);
  return d;
}

function sampleOps(n = 3) {
  const r = new Replica(PC, USER);
  r.put('research', '20000000-0000-4000-8000-000000000001', {
    user_id: USER,
    name: 'R',
    description: '',
    archived: false,
  });
  for (let i = 1; i < n; i++)
    r.put('research', '20000000-0000-4000-8000-000000000001', { name: `R${i}` });
  return r;
}

describe('framing de Native Messaging', () => {
  it('codifica e decodifica quadros, inclusive fragmentados', async () => {
    const stream = new PassThrough();
    const got: unknown[] = [];
    frameReader(stream, (m) => got.push(m));
    const a = encodeFrame({ a: 1, texto: 'ção' });
    const b = encodeFrame({ b: [1, 2] });
    const all = Buffer.concat([a, b]);
    stream.write(all.subarray(0, 3));
    stream.write(all.subarray(3, 10));
    stream.write(all.subarray(10));
    await new Promise((r) => setImmediate(r));
    expect(got).toEqual([{ a: 1, texto: 'ção' }, { b: [1, 2] }]);
    expect(a.readUInt32LE(0)).toBe(a.length - 4);
  });

  it('recusa mensagens acima de 1 MB para o Chrome', () => {
    expect(() => encodeFrame({ x: 'a'.repeat(1024 * 1024) })).toThrow(/grande demais/);
  });
});

describe('HelperDb', () => {
  it('insere operações de forma idempotente e causal e pagina', () => {
    const db = new HelperDb(join(tmp(), 'h.db'));
    const r = sampleOps(5);
    expect(db.insertOps(r.log)).toHaveLength(5);
    expect(db.insertOps(r.log)).toHaveLength(0);
    expect(db.versionVector()).toEqual({ [PC]: 5 });
    const page = db.opsSince({}, 2);
    expect(page.ops.map((o) => o.seq)).toEqual([1, 2]);
    expect(page.more).toBe(true);
    expect(() => db.insertOps([{ ...r.log[0]!, seq: 9 }])).toThrow();
    db.close();
  });

  it('token de pareamento é de uso único e expira', () => {
    const db = new HelperDb(join(tmp(), 'h.db'));
    db.createToken('t1', 1000, 0);
    expect(db.consumeToken('t1', 10)).toBe(true);
    expect(db.consumeToken('t1', 10)).toBe(false);
    db.createToken('t2', 1000, 0);
    expect(db.consumeToken('t2', 5000)).toBe(false);
    db.close();
  });
});

describe('daemon + shim', () => {
  it('extensão vincula, envia e recebe operações pelo shim; backup é gravado atomicamente', async () => {
    const d = await daemon();
    const input = new PassThrough();
    const output = new PassThrough();
    const replies: Record<string, unknown>[] = [];
    frameReader(output, (m) => replies.push(m as Record<string, unknown>));
    await runShim({ pipe: d.helper.opts.pipe, input, output, spawnDaemon: () => undefined });
    const ask = async (id: number, req: unknown) => {
      input.write(encodeFrame({ id, req }));
      for (let i = 0; i < 100 && !replies.some((r) => r.id === id); i++)
        await new Promise((r) => setTimeout(r, 20));
      return replies.find((r) => r.id === id)!;
    };

    expect(await ask(1, { type: 'pull', vv: {} })).toMatchObject({ ok: false, error: /hello/ });
    expect(
      await ask(2, { type: 'hello', deviceId: PC, userId: USER, deviceName: 'PC' }),
    ).toMatchObject({
      ok: true,
      data: { linked: true },
    });
    const r = sampleOps(3);
    expect(await ask(3, { type: 'push', ops: r.log })).toMatchObject({
      ok: true,
      data: { applied: 3 },
    });
    expect(await ask(4, { type: 'pull', vv: { [PC]: 1 } })).toMatchObject({
      ok: true,
      data: { more: false },
    });
    expect(
      ((await ask(4.5, { type: 'pull', vv: {} })).data as { ops: unknown[] }).ops,
    ).toHaveLength(3);
    expect(
      await ask(5, { type: 'hello', deviceId: 'outro', userId: USER, deviceName: 'X' }),
    ).toMatchObject({
      ok: false,
    });
    const w = (await ask(6, {
      type: 'backup:write',
      filename: 'cuepoint-backup-1.json',
      content: '{"a":1}',
    })) as {
      data: { path: string };
    };
    expect(readFileSync(w.data.path, 'utf8')).toBe('{"a":1}');
    expect(existsSync(`${w.data.path}.tmp`)).toBe(false);
    input.end();
  });

  it('cliente IPC recebe evento quando chegam operações e o estado persiste ao reiniciar', async () => {
    const dir = tmp();
    let d = await daemon(dir);
    const c = await IpcClient.connect(d.helper.opts.pipe);
    await c.request({ type: 'hello', deviceId: PC, userId: USER, deviceName: 'PC' });
    await c.request({ type: 'push', ops: sampleOps(2).log });
    await new Promise((r) => setTimeout(r, 50));
    expect(c.events.some((e) => e.event === 'changed')).toBe(true);
    c.close();
    await running.pop()!.stop();
    d = await daemon(dir);
    const c2 = await IpcClient.connect(d.helper.opts.pipe);
    expect(await c2.request({ type: 'status' })).toMatchObject({ linked: true, ops: 2 });
    c2.close();
  });
});
