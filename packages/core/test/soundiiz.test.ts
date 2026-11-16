/**
 * Exportação via Soundiiz (Sprint 17). Gera spec/vectors/soundiiz.json, lido também pela suíte
 * Kotlin (`SoundiizVectorsTest`). Regenerar após mudança intencional:
 * `npm run vectors -w @cuepoint/core`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SOUNDIIZ_DEFAULT_DESCRIPTION,
  SOUNDIIZ_DESTINATION,
  SOUNDIIZ_IMPORT_URL,
  SOUNDIIZ_MAX_TRACKS,
  SOUNDIIZ_SHARE_PREFIX,
  SOUNDIIZ_SOURCE_NAME,
  soundiizCheck,
  soundiizImportRequest,
  soundiizParseResponse,
  type SoundiizPlaylistInput,
} from '../src';

const spec = resolve(__dirname, '../../../spec/vectors/soundiiz.json');
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

const inputCases: { name: string; input: SoundiizPlaylistInput }[] = [
  {
    name: 'ordem preservada, artista único',
    input: {
      name: 'Warm-up de sábado',
      description: 'Abertura do set',
      tracks: [
        { title: 'Faixa B', artist: 'Artista 2' },
        { title: 'Faixa A', artist: 'Artista 1' },
        { title: 'Faixa C', artist: 'Artista 1' },
      ],
    },
  },
  {
    name: 'descrição só com espaços usa a padrão',
    input: { name: 'Sem descrição', description: '   ', tracks: [{ title: 'X', artist: 'Y' }] },
  },
  {
    name: 'descrição nula',
    input: { name: 'Nula', description: null, tracks: [{ title: 'X', artist: 'Y' }] },
  },
  {
    name: 'artista vazio é omitido e espaços são aparados',
    input: {
      name: '  Aparar  ',
      description: '',
      tracks: [
        { title: '  Só título  ', artist: '   ' },
        { title: 'Com artista', artist: ' Selo ' },
      ],
    },
  },
  {
    name: 'caracteres especiais e título no formato "Artista - Música"',
    input: {
      name: 'Ação & "aspas" / barra — 🎧',
      description: 'Linha 1\nLinha 2',
      tracks: [
        { title: 'Artista X - Música (Remix) [Edit]', artist: 'Selo Ç' },
        { title: 'Ñandú ☆ 東京', artist: 'Earth, Wind & Fire' },
      ],
    },
  },
];
const inputs = inputCases.map((c) => ({ ...c, expected: soundiizImportRequest(c.input) }));

const checks = [0, 1, SOUNDIIZ_MAX_TRACKS, SOUNDIIZ_MAX_TRACKS + 1].map((count) => ({
  count,
  expected: soundiizCheck(count),
}));

const SHARE = 'https://soundiiz.com/go/import-playlist/0123456789abcdef0123456789abcdef';
const responses = [
  {
    name: 'sucesso',
    status: 200,
    body: { status: 'success', nbTracks: 3, shareUrl: SHARE, expiresAt: 1782220923 },
  },
  {
    name: 'sucesso com link fora do Soundiiz é recusado',
    status: 200,
    body: { status: 'success', nbTracks: 3, shareUrl: 'https://exemplo.com/x', expiresAt: 1 },
  },
  { name: 'sucesso sem campos', status: 200, body: { status: 'success' } },
  {
    name: '400 com mensagem',
    status: 400,
    body: { status: 'error', message: 'Missing track title at index 1.' },
  },
  { name: '400 sem JSON', status: 400, body: null },
  { name: '429', status: 429, body: null },
  { name: '503', status: 503, body: { status: 'error', message: 'Maintenance' } },
  { name: '404', status: 404, body: null },
  { name: '200 com status de erro', status: 200, body: { status: 'error', message: 'x' } },
].map((c) => ({ ...c, expected: soundiizParseResponse(c.status, c.body) }));

describe('exportação via Soundiiz', () => {
  it('spec/vectors/soundiiz.json está atualizado', async () => {
    await expect(
      pretty({
        version: 1,
        description:
          'Pedido à API de importação do Soundiiz, compartilhado entre a extensão (TS) e o app Android (Kotlin). Gerado por packages/core/test/soundiiz.test.ts.',
        constants: {
          importUrl: SOUNDIIZ_IMPORT_URL,
          maxTracks: SOUNDIIZ_MAX_TRACKS,
          destination: SOUNDIIZ_DESTINATION,
          sourceName: SOUNDIIZ_SOURCE_NAME,
          defaultDescription: SOUNDIIZ_DEFAULT_DESCRIPTION,
          sharePrefix: SOUNDIIZ_SHARE_PREFIX,
        },
        requests: inputs,
        checks,
        responses,
      }),
    ).toMatchFileSnapshot(spec);
  });

  it('os casos do arquivo valem para as funções do core', () => {
    const file = JSON.parse(readFileSync(spec, 'utf8')) as {
      requests: typeof inputs;
      checks: typeof checks;
      responses: typeof responses;
    };
    for (const c of file.requests)
      expect(soundiizImportRequest(c.input), c.name).toEqual(c.expected);
    for (const c of file.checks) expect(soundiizCheck(c.count)).toEqual(c.expected);
    for (const c of file.responses)
      expect(soundiizParseResponse(c.status, c.body), c.name).toEqual(c.expected);
  });

  it('pedido segue o contrato documentado', () => {
    const { url, headers, payload } = inputs[0]!.expected;
    expect(url).toBe('https://soundiiz.com/go/import-playlist');
    expect(headers['content-type']).toBe('application/json');
    expect(payload.destination).toBe('soundcloud');
    expect(payload.sourceName).toBe('CuePoint');
    expect(payload.tracklist.map((t) => t.title)).toEqual(['Faixa B', 'Faixa A', 'Faixa C']);
    expect(payload.tracklist[0]).toEqual({ title: 'Faixa B', artists: ['Artista 2'] });
    // nada que o CuePoint não saiba (album, isrc) nem identificadores do SoundCloud
    for (const t of payload.tracklist) expect(Object.keys(t).sort()).toEqual(['artists', 'title']);
  });

  it('limite de 1 a 200 faixas', () => {
    expect(soundiizCheck(0)).toEqual({ code: 'empty' });
    expect(soundiizCheck(1)).toBeNull();
    expect(soundiizCheck(200)).toBeNull();
    expect(soundiizCheck(201)).toEqual({ code: 'too_many', count: 201, max: 200 });
  });

  it('respostas', () => {
    const [ok, foreign, , bad, , r429, r503, r404] = responses.map((r) => r.expected);
    expect(ok).toEqual({ ok: true, shareUrl: SHARE, nbTracks: 3, expiresAt: 1782220923 });
    expect(foreign).toMatchObject({ ok: false, code: 'http' });
    expect(bad).toEqual({
      ok: false,
      code: 'invalid',
      status: 400,
      message: 'Missing track title at index 1.',
    });
    expect(r429).toMatchObject({ ok: false, code: 'unavailable' });
    expect(r503).toMatchObject({ ok: false, code: 'unavailable', message: 'Maintenance' });
    expect(r404).toMatchObject({ ok: false, code: 'http' });
  });
});
