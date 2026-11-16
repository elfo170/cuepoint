import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest.json';

describe('manifest', () => {
  it('é MV3 com chave fixa e acesso ao SoundCloud', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.key.length).toBeGreaterThan(100);
    expect(manifest.host_permissions).toContain('https://soundcloud.com/*');
  });

  it('libera só a API do Soundiiz além do SoundCloud (CORS da exportação via Soundiiz)', () => {
    expect(manifest.host_permissions).toEqual([
      'https://soundcloud.com/*',
      'https://soundiiz.com/*',
    ]);
  });
});
