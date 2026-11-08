const SOUNDCLOUD_HOST = 'soundcloud.com';

const RESERVED_ROOTS = new Set([
  'you',
  'discover',
  'search',
  'stream',
  'upload',
  'settings',
  'charts',
  'messages',
  'notifications',
  'pages',
  'terms-of-use',
]);
const RESERVED_SUBPATHS = new Set([
  'sets',
  'likes',
  'tracks',
  'reposts',
  'albums',
  'followers',
  'following',
  'popular-tracks',
  'comments',
]);

/**
 * Normaliza a URL de uma faixa: absoluta, https, sem query/hash e sem barra final.
 * Retorna null se não parecer uma URL de faixa (`/<artista>/<faixa>`).
 */
export function normalizeTrackUrl(
  href: string | null | undefined,
  base = 'https://soundcloud.com/',
): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  if (host !== SOUNDCLOUD_HOST) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [user, slug] = parts as [string, string];
  if (RESERVED_ROOTS.has(user) || RESERVED_SUBPATHS.has(slug)) return null;
  return `https://${SOUNDCLOUD_HOST}/${user}/${slug}`;
}

const URN_PATTERNS = [
  /soundcloud:\/\/sounds:(\d+)/,
  /"urn"\s*:\s*"soundcloud:tracks:(\d+)"/,
  /api\.soundcloud\.com\/tracks\/(\d+)/,
];

/** Extrai o URN da faixa do HTML da página dela (meta tags de app links / hidratação). */
export function extractUrnFromHtml(html: string): string | null {
  for (const re of URN_PATTERNS) {
    const m = re.exec(html);
    if (m) return `soundcloud:tracks:${m[1]}`;
  }
  return null;
}

export function isValidUrn(urn: string | null | undefined): urn is string {
  return !!urn && /^soundcloud:tracks:\d+$/.test(urn);
}

/** Converte a URL de capa para uma resolução maior (t500x500). */
export function upscaleArtwork(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/-(t\d+x\d+|large|small|badge|tiny|mini)\.(jpg|png|webp)/, '-t500x500.$2');
}
