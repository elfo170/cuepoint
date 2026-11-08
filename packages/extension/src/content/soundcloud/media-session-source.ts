import { sameTrack, type NowPlaying, type TrackSource } from './types';
import { upscaleArtwork } from './url';

/** Lê `navigator.mediaSession.metadata` (fallback quando o DOM não traz a faixa). */
export function readNowPlayingFromMediaSession(nav: Navigator = navigator): NowPlaying | null {
  const meta = nav.mediaSession?.metadata;
  if (!meta || !meta.title) return null;
  const art = meta.artwork?.length ? meta.artwork[meta.artwork.length - 1]!.src : null;
  return {
    title: meta.title.trim(),
    artist: (meta.artist || '').trim(),
    url: null,
    urn: null,
    artworkUrl: upscaleArtwork(art),
    isPlaying: nav.mediaSession.playbackState === 'playing',
    source: 'mediasession',
  };
}

/** Polling leve da MediaSession (não há evento de mudança de metadata). */
export class MediaSessionTrackSource implements TrackSource {
  constructor(
    private readonly nav: Navigator = navigator,
    private readonly intervalMs = 1000,
  ) {}

  start(onChange: (track: NowPlaying | null) => void): () => void {
    let last: NowPlaying | null = null;
    const tick = () => {
      const current = readNowPlayingFromMediaSession(this.nav);
      if (!sameTrack(current, last)) {
        last = current;
        onChange(current);
      }
    };
    tick();
    const id = setInterval(tick, this.intervalMs);
    return () => clearInterval(id);
  }
}
