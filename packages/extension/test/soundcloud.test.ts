import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DomTrackSource,
  extractUrnFromHtml,
  isValidUrn,
  normalizeTrackUrl,
  readNowPlayingFromDom,
  readNowPlayingFromMediaSession,
  SoundCloudTrackSource,
  UrnResolver,
  type NowPlaying,
  type TrackSource,
} from '../src/content/soundcloud';

const playerHtml = readFileSync(resolve(__dirname, 'fixtures/soundcloud-player.html'), 'utf8');
const trackPageHtml = readFileSync(
  resolve(__dirname, 'fixtures/soundcloud-track-page.html'),
  'utf8',
);

function loadPlayer() {
  document.documentElement.innerHTML = playerHtml.replace(/<!doctype html>/i, '');
}

function setTrack(t: { href: string; title: string; artist: string }) {
  const link = document.querySelector('.playbackSoundBadge__titleLink')!;
  link.setAttribute('href', t.href);
  link.setAttribute('title', t.title);
  link.querySelector('span[aria-hidden]')!.textContent = t.title;
  const artist = document.querySelector('.playbackSoundBadge__lightLink')!;
  artist.setAttribute('title', t.artist);
  artist.textContent = t.artist;
}

describe('normalizeTrackUrl', () => {
  it('remove query string e torna a URL absoluta', () => {
    expect(normalizeTrackUrl('/artist/track?in=artist/sets/x&si=abc')).toBe(
      'https://soundcloud.com/artist/track',
    );
    expect(normalizeTrackUrl('https://m.soundcloud.com/a/b/')).toBe('https://soundcloud.com/a/b');
  });

  it('recusa URLs que não são de faixa', () => {
    expect(normalizeTrackUrl('/artist')).toBeNull();
    expect(normalizeTrackUrl('/artist/sets')).toBeNull();
    expect(normalizeTrackUrl('/artist/sets/playlist')).toBeNull();
    expect(normalizeTrackUrl('/discover/sets')).toBeNull();
    expect(normalizeTrackUrl('https://example.com/a/b')).toBeNull();
    expect(normalizeTrackUrl(null)).toBeNull();
  });
});

describe('URN', () => {
  it('extrai o URN das meta tags da página da faixa', () => {
    expect(extractUrnFromHtml(trackPageHtml)).toBe('soundcloud:tracks:123456789');
    expect(extractUrnFromHtml('{"urn":"soundcloud:tracks:42"}')).toBe('soundcloud:tracks:42');
    expect(extractUrnFromHtml('<html></html>')).toBeNull();
  });

  it('valida o formato', () => {
    expect(isValidUrn('soundcloud:tracks:1')).toBe(true);
    expect(isValidUrn('soundcloud:users:1')).toBe(false);
  });

  it('resolve com cache e permite nova tentativa após falha', async () => {
    const fetcher = vi
      .fn<(url: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(trackPageHtml);
    const resolver = new UrnResolver(fetcher);
    expect(await resolver.resolve('https://soundcloud.com/a/b')).toBeNull();
    expect(await resolver.resolve('https://soundcloud.com/a/b')).toBe(
      'soundcloud:tracks:123456789',
    );
    expect(await resolver.resolve('https://soundcloud.com/a/b')).toBe(
      'soundcloud:tracks:123456789',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('leitura do DOM', () => {
  beforeEach(loadPlayer);

  it('lê título, artista, URL, capa e estado de reprodução', () => {
    expect(readNowPlayingFromDom(document)).toEqual<NowPlaying>({
      title: 'Deep Groove',
      artist: 'Fixture Artist',
      url: 'https://soundcloud.com/fixture-artist/deep-groove',
      urn: null,
      artworkUrl: 'https://i1.sndcdn.com/artworks-000123-abc-t500x500.jpg',
      isPlaying: true,
      source: 'dom',
    });
  });

  it('retorna null sem barra de reprodução', () => {
    document.body.innerHTML = '<main></main>';
    expect(readNowPlayingFromDom(document)).toBeNull();
  });

  it('detecta a troca de faixa via MutationObserver', async () => {
    const seen: (NowPlaying | null)[] = [];
    const stop = new DomTrackSource(document).start((t) => seen.push(t));
    setTrack({ href: '/other/next-one', title: 'Next One', artist: 'Other' });
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(seen.map((t) => t?.title)).toEqual(['Deep Groove', 'Next One']);
    expect(seen[1]?.url).toBe('https://soundcloud.com/other/next-one');
  });
});

describe('MediaSession', () => {
  it('usa metadata como fallback', () => {
    const nav = {
      mediaSession: {
        playbackState: 'playing',
        metadata: { title: ' Song ', artist: 'Band', artwork: [{ src: 'https://x/a-t50x50.jpg' }] },
      },
    } as unknown as Navigator;
    expect(readNowPlayingFromMediaSession(nav)).toMatchObject({
      title: 'Song',
      artist: 'Band',
      url: null,
      isPlaying: true,
      artworkUrl: 'https://x/a-t500x500.jpg',
      source: 'mediasession',
    });
  });
});

class ManualSource implements TrackSource {
  emit: (t: NowPlaying | null) => void = () => undefined;
  start(cb: (t: NowPlaying | null) => void) {
    this.emit = cb;
    return () => undefined;
  }
}

const sample = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  title: 'T',
  artist: 'A',
  url: 'https://soundcloud.com/a/t',
  urn: null,
  artworkUrl: null,
  isPlaying: true,
  source: 'dom',
  ...over,
});

describe('SoundCloudTrackSource', () => {
  it('prioriza o DOM, cai para a MediaSession e resolve o URN', async () => {
    const dom = new ManualSource();
    const session = new ManualSource();
    const resolver = new UrnResolver(async () => trackPageHtml);
    const seen: (NowPlaying | null)[] = [];
    new SoundCloudTrackSource(dom, session, resolver).start((t) => seen.push(t));

    session.emit(sample({ source: 'mediasession', url: null, title: 'From session' }));
    dom.emit(sample());
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.at(-1)).toMatchObject({ title: 'T', urn: 'soundcloud:tracks:123456789' });

    // Pausa: mantém o URN já resolvido
    dom.emit(sample({ isPlaying: false }));
    expect(seen.at(-1)).toMatchObject({ isPlaying: false, urn: 'soundcloud:tracks:123456789' });

    dom.emit(null);
    expect(seen.at(-1)).toMatchObject({ title: 'From session' });
  });
});
