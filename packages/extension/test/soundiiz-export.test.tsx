import type { Playlist } from '@cuepoint/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistItem } from '../src/data/playlists';
import { SoundiizExport } from '../src/library/pages/SoundiizExport';
import { soundiizExport } from '../src/library/soundiiz';

const SHARE = 'https://soundiiz.com/go/import-playlist/0123456789abcdef0123456789abcdef';
const playlist = {
  id: 'pl-1',
  name: 'House',
  description: '',
} as unknown as Playlist;
const items = (n: number, artist = 'Artista') =>
  Array.from({ length: n }, (_, i) => ({
    item: { id: `it-${i}` },
    track: { id: `tr-${i}`, title: `Faixa ${i + 1}`, artist },
  })) as unknown as PlaylistItem[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();
const create = vi.fn(async () => ({}));

beforeEach(() => {
  fetchMock.mockReset();
  create.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', { tabs: { create } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const click = () => act(async () => fireEvent.click(screen.getByTestId('soundiiz-export')));

describe('soundiizExport', () => {
  it('envia o pedido do core, na ordem da playlist', async () => {
    fetchMock.mockResolvedValue(
      json(200, { status: 'success', nbTracks: 3, shareUrl: SHARE, expiresAt: 1782220923 }),
    );
    const r = await soundiizExport(playlist, items(3));
    expect(r).toEqual({ ok: true, shareUrl: SHARE, nbTracks: 3, expiresAt: 1782220923 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://soundiiz.com/go/import-playlist');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      title: 'House',
      sourceName: 'CuePoint',
      destination: 'soundcloud',
      description: 'Playlist exportada do CuePoint',
    });
    expect(body.tracklist).toEqual([
      { title: 'Faixa 1', artists: ['Artista'] },
      { title: 'Faixa 2', artists: ['Artista'] },
      { title: 'Faixa 3', artists: ['Artista'] },
    ]);
  });

  it('falha de rede vira erro "network"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await soundiizExport(playlist, items(1))).toMatchObject({ ok: false, code: 'network' });
  });
});

describe('cartão "SoundCloud via Soundiiz"', () => {
  it('sucesso abre o link numa aba nova e mostra a validade', async () => {
    fetchMock.mockResolvedValue(
      json(200, { status: 'success', nbTracks: 2, shareUrl: SHARE, expiresAt: 1782220923 }),
    );
    render(<SoundiizExport playlist={playlist} items={items(2)} />);
    expect(screen.getByText(/pode errar a versão/)).toBeTruthy();
    await click();
    expect(create).toHaveBeenCalledWith({ url: SHARE });
    expect(screen.getByRole('status').textContent).toMatch(/Link criado com 2 música\(s\)/);
    expect(screen.getByRole('link', { name: /Abrir de novo/ }).getAttribute('href')).toBe(SHARE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('avisa quando o Soundiiz aceita menos músicas que as enviadas', async () => {
    fetchMock.mockResolvedValue(
      json(200, { status: 'success', nbTracks: 2, shareUrl: SHARE, expiresAt: 1782220923 }),
    );
    render(<SoundiizExport playlist={playlist} items={items(3)} />);
    await click();
    expect(screen.getByText('O Soundiiz aceitou 2 de 3 músicas.')).toBeTruthy();
  });

  it('400 mostra a mensagem do Soundiiz e não abre aba', async () => {
    fetchMock.mockResolvedValue(
      json(400, { status: 'error', message: 'Missing track title at index 1.' }),
    );
    render(<SoundiizExport playlist={playlist} items={items(2)} />);
    await click();
    expect(screen.getByRole('alert').textContent).toBe('O Soundiiz recusou a playlist.');
    expect(create).not.toHaveBeenCalled();
  });

  it('429 vira "indisponível", sem nova tentativa automática', async () => {
    fetchMock.mockResolvedValue(json(429, { status: 'error', message: 'Too many requests.' }));
    render(<SoundiizExport playlist={playlist} items={items(2)} />);
    await click();
    expect(screen.getByRole('alert').textContent).toBe(
      'Soundiiz indisponível. Tente em alguns minutos.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sem conexão mostra erro legível', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SoundiizExport playlist={playlist} items={items(1)} />);
    await click();
    expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível falar com o Soundiiz/);
  });

  it('link fora do Soundiiz não é aberto', async () => {
    fetchMock.mockResolvedValue(
      json(200, { status: 'success', nbTracks: 1, shareUrl: 'https://x.com/', expiresAt: 1 }),
    );
    render(<SoundiizExport playlist={playlist} items={items(1)} />);
    await click();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Erro no Soundiiz. Tente mais tarde.');
  });

  it('playlist vazia: botão desabilitado', () => {
    render(<SoundiizExport playlist={playlist} items={[]} />);
    expect((screen.getByTestId('soundiiz-export') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('soundiiz-blocked').textContent).toMatch(/Playlist vazia/);
  });

  it('acima de 200 músicas: bloqueia com aviso e não envia', async () => {
    render(<SoundiizExport playlist={playlist} items={items(201)} />);
    expect((screen.getByTestId('soundiiz-export') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('soundiiz-blocked').textContent).toBe(
      'Máximo de 200 músicas por envio (esta tem 201).',
    );
    await click();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('com 200 músicas o envio é liberado', () => {
    render(<SoundiizExport playlist={playlist} items={items(200)} />);
    expect((screen.getByTestId('soundiiz-export') as HTMLButtonElement).disabled).toBe(false);
  });
});
