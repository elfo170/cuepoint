import { DomTrackSource } from './dom-source';
import { MediaSessionTrackSource } from './media-session-source';
import type { NowPlaying, TrackSource } from './types';
import { UrnResolver } from './urn-resolver';

export type { NowPlaying, TrackSource } from './types';
export { normalizeTrackUrl, extractUrnFromHtml, isValidUrn } from './url';
export { UrnResolver } from './urn-resolver';
export { readNowPlayingFromDom, DomTrackSource } from './dom-source';
export { readNowPlayingFromMediaSession, MediaSessionTrackSource } from './media-session-source';

function sameIdentity(a: NowPlaying | null, b: NowPlaying | null): boolean {
  if (!a || !b) return a === b;
  return a.url === b.url && a.title === b.title && a.artist === b.artist;
}

/**
 * Fonte combinada: prioriza o DOM (que traz a URL), usa a MediaSession como fallback e
 * enriquece a faixa com o URN, resolvido de forma assíncrona.
 */
export class SoundCloudTrackSource implements TrackSource {
  constructor(
    private readonly dom: TrackSource = new DomTrackSource(),
    private readonly mediaSession: TrackSource = new MediaSessionTrackSource(),
    private readonly resolver = new UrnResolver(),
  ) {}

  start(onChange: (track: NowPlaying | null) => void): () => void {
    let fromDom: NowPlaying | null = null;
    let fromSession: NowPlaying | null = null;
    let last: NowPlaying | null = null;

    const publish = () => {
      const base = fromDom ?? fromSession;
      const next: NowPlaying | null =
        base && last && sameIdentity(base, last) ? { ...base, urn: last.urn } : base;
      if (JSON.stringify(next) === JSON.stringify(last)) return;
      last = next;
      onChange(next);
      if (next?.url && !next.urn) {
        const url = next.url;
        void this.resolver.resolve(url).then((urn) => {
          if (!urn || !last || last.url !== url || last.urn) return;
          last = { ...last, urn };
          onChange(last);
        });
      }
    };

    const stopDom = this.dom.start((t) => {
      fromDom = t;
      publish();
    });
    const stopSession = this.mediaSession.start((t) => {
      fromSession = t;
      publish();
    });
    return () => {
      stopDom();
      stopSession();
    };
  }
}
