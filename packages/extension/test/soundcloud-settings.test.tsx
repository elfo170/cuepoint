import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScStatus } from '../src/library/soundcloud';

const scRequest = vi.fn();
vi.mock('../src/library/soundcloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/library/soundcloud')>()),
  scRequest: (req: unknown) => scRequest(req),
}));

const { PhoneShare } = await import('../src/library/pages/SoundCloudSettings');

const PHONE = 'cccccccc-0000-4000-8000-00000000000c';
const base: ScStatus = {
  state: 'connected',
  clientId: 'app-••••id',
  user: { username: 'dj', permalinkUrl: null },
  loginPending: false,
  lastError: null,
  redirectUri: 'http://127.0.0.1:47801/callback',
  devices: [],
};

function show(status: ScStatus, reload = vi.fn(async () => undefined)) {
  render(
    <MemoryRouter>
      <PhoneShare status={status} reload={reload} />
    </MemoryRouter>,
  );
  return reload;
}

beforeEach(() => scRequest.mockReset().mockResolvedValue({}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Configurações → SoundCloud → Usar no celular', () => {
  it('sem celular pareado, aponta para Dispositivos', () => {
    show(base);
    expect(screen.getByText(/Nenhum celular pareado/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dispositivos' }).getAttribute('href')).toBe(
      '/devices',
    );
  });

  it('"Enviar para" libera o aparelho e recarrega o estado', async () => {
    const reload = show({
      ...base,
      devices: [{ peerId: PHONE, name: 'Redmi', expiresAt: null, sharedAt: null }],
    });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: /Enviar para Redmi/ })),
    );
    expect(scRequest).toHaveBeenCalledWith({ type: 'sc:share', peerId: PHONE });
    expect(reload).toHaveBeenCalled();
  });

  it('liberado: mostra a contagem, a instrução e Cancelar', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    const reload = show({
      ...base,
      devices: [
        { peerId: PHONE, name: 'Redmi', expiresAt: Date.now() + 10 * 60 * 1000, sharedAt: null },
      ],
    });
    expect(screen.getByText(/Liberado por 10:00/)).toBeTruthy();
    expect(screen.getByText('Receber do PC')).toBeTruthy();
    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByText(/Liberado por 8:59/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })));
    expect(scRequest).toHaveBeenCalledWith({ type: 'sc:share-cancel', peerId: PHONE });
    expect(reload).toHaveBeenCalled();
  });

  it('depois da entrega mostra quando foi enviado; erro do serviço aparece', async () => {
    scRequest.mockRejectedValueOnce(new Error('Esse aparelho não está pareado com este PC.'));
    show({
      ...base,
      devices: [
        { peerId: PHONE, name: 'Redmi', expiresAt: null, sharedAt: '2026-11-12T12:05:00.000Z' },
      ],
    });
    expect(screen.getByText(/Enviado em/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Enviar para/ })));
    expect(screen.getByText('Esse aparelho não está pareado com este PC.')).toBeTruthy();
  });
});
