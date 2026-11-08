// Build da extensão MV3: páginas (React), service worker (ESM) e content script (IIFE).
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, mkdirSync, readFileSync, rmSync, watchFile, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch') ? {} : null;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Manifesto e ícones (gravados antes dos builds; em --watch os builds não bloqueiam)
const manifestPath = resolve(root, 'src/manifest.json');
const writeManifest = () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
};
writeManifest();
cpSync(resolve(root, 'public/icons'), resolve(outDir, 'icons'), { recursive: true });
if (watch) watchFile(manifestPath, { interval: 500 }, writeManifest);

const common = {
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
};

// 1. Páginas da extensão
await build({
  ...common,
  publicDir: resolve(root, 'public'),
  build: {
    outDir,
    emptyOutDir: false,
    watch,
    rollupOptions: {
      input: {
        library: resolve(root, 'library.html'),
        popup: resolve(root, 'popup.html'),
      },
    },
  },
});

// 2. Service worker e 3. content script (arquivos únicos, sem chunks compartilhados)
for (const [name, entry, format] of [
  ['background', 'src/background/index.ts', 'es'],
  ['content', 'src/content/index.tsx', 'iife'],
  ['keyguard', 'src/content/keyguard.ts', 'iife'],
]) {
  await build({
    ...common,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      watch,
      cssCodeSplit: false,
      lib: {
        entry: resolve(root, entry),
        formats: [format],
        name: `cuepoint_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  });
}

console.log(
  watch ? `observando alterações; extensão em ${outDir}` : `extensão gerada em ${outDir}`,
);
