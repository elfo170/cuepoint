import { SELECTORS } from './selectors';
import { sameTrack, type NowPlaying, type TrackSource } from './types';
import { normalizeTrackUrl, upscaleArtwork } from './url';

function text(el: Element | null): string {
  return (el?.getAttribute('title') || el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function backgroundUrl(el: Element | null): string | null {
  const style =
    (el as HTMLElement | null)?.style?.backgroundImage || el?.getAttribute('style') || '';
  const m = /url\(["']?([^"')]+)["']?\)/.exec(style);
  return m ? m[1]! : null;
}

/** Lê a faixa atual da barra de reprodução. Função pura sobre o DOM (testável com fixtures). */
export function readNowPlayingFromDom(doc: Document): NowPlaying | null {
  const titleLink = doc.querySelector(SELECTORS.titleLink);
  if (!titleLink) return null;
  const title = text(titleLink.querySelector('span[aria-hidden="true"]')) || text(titleLink);
  if (!title) return null;
  const artist = text(doc.querySelector(SELECTORS.artistLink));
  // Hrefs relativos são sempre resolvidos contra soundcloud.com (a página atual não importa).
  const url = normalizeTrackUrl(titleLink.getAttribute('href'));
  const playButton = doc.querySelector(SELECTORS.playButton);
  return {
    title,
    artist,
    url,
    urn: null,
    artworkUrl: upscaleArtwork(backgroundUrl(doc.querySelector(SELECTORS.artwork))),
    isPlaying: !!playButton?.classList.contains(SELECTORS.playingClass),
    source: 'dom',
  };
}

/** Observa a barra de reprodução via MutationObserver. */
export class DomTrackSource implements TrackSource {
  constructor(private readonly doc: Document = document) {}

  start(onChange: (track: NowPlaying | null) => void): () => void {
    let last: NowPlaying | null = null;
    let scheduled = false;
    const emit = () => {
      scheduled = false;
      const current = readNowPlayingFromDom(this.doc);
      if (!sameTrack(current, last)) {
        last = current;
        onChange(current);
      }
    };
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(emit);
    });
    observer.observe(this.doc.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'title', 'class', 'style'],
    });
    emit();
    return () => observer.disconnect();
  }
}
