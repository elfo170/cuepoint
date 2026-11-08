import { extractUrnFromHtml } from './url';

export type Fetcher = (url: string) => Promise<string>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/**
 * Resolve o URN de uma faixa a partir da URL dela, buscando a página e lendo as meta tags.
 * Resultados ficam em cache; falhas de rede não, para permitir nova tentativa.
 */
export class UrnResolver {
  private cache = new Map<string, Promise<string | null>>();

  constructor(private readonly fetcher: Fetcher = defaultFetcher) {}

  resolve(url: string): Promise<string | null> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.fetcher(url)
        .then(extractUrnFromHtml)
        .catch(() => {
          this.cache.delete(url);
          return null;
        });
      this.cache.set(url, pending);
    }
    return pending;
  }
}
