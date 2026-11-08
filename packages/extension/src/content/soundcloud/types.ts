/** Faixa em reprodução, normalizada a partir da página do SoundCloud. */
export interface NowPlaying {
  title: string;
  artist: string;
  /** URL canônica da faixa (sem query string), quando disponível. */
  url: string | null;
  /** URN SoundCloud (`soundcloud:tracks:<id>`), quando resolvido. */
  urn: string | null;
  artworkUrl: string | null;
  isPlaying: boolean;
  /** De onde vieram os dados. */
  source: 'dom' | 'mediasession';
}

/** Fonte de "faixa atual". Isolada para permitir trocar a estratégia quando o SoundCloud mudar. */
export interface TrackSource {
  /** Começa a observar; devolve a função para parar. */
  start(onChange: (track: NowPlaying | null) => void): () => void;
}

export function sameTrack(a: NowPlaying | null, b: NowPlaying | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.url === b.url &&
    a.urn === b.urn &&
    a.artworkUrl === b.artworkUrl &&
    a.isPlaying === b.isPlaying
  );
}
