// Gera os ícones da extensão e do app Android a partir de assets/cuepoint-logo.svg.
// Rasteriza com o Chromium do Playwright (já instalado para os testes e2e).
//
// Uso:  npm run icons
//
// - Extensão: packages/extension/public/icons/icon{16,48,128}.png (o SVG inteiro, com o fundo).
// - Android: res/mipmap-*/ic_launcher_foreground.png (só o logo, fundo transparente) para o
//   ícone adaptativo. O fundo vem de res/values/ic_launcher_colors.xml (a cor do <rect> do SVG).
//   O logo é reduzido para caber na zona segura (círculo de 66dp no centro da tela de 108dp), para
//   nenhuma máscara do launcher cortá-lo.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/cuepoint-logo.svg'), 'utf8');

const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
if (!viewBox || viewBox[1] !== viewBox[2]) throw new Error('o SVG precisa ter viewBox quadrado');
const side = Number(viewBox[1]);
const bgRect = /<rect [^>]*fill="(#[0-9a-fA-F]{6})"[^>]*\/>\s*/.exec(svg);
if (!bgRect) throw new Error('o SVG precisa ter o <rect> de fundo');
const background = bgRect[1].toUpperCase();
const logoOnly = svg.replace(bgRect[0], '');

const sized = (source, px) =>
  source.replace(/width="[\d.]+" height="[\d.]+"/, `width="${px}" height="${px}"`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (source, px) => {
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${sized(source, px)}</body></html>`,
    );
    return page.locator('svg').screenshot({ omitBackground: true });
  };

  // Extensão
  const extIcons = join(root, 'packages/extension/public/icons');
  mkdirSync(extIcons, { recursive: true });
  for (const px of [16, 48, 128])
    writeFileSync(join(extIcons, `icon${px}.png`), await render(svg, px));

  // Android: maior distância do centro até um pixel do logo, em unidades do viewBox
  const probe = 1024;
  const png = (await render(logoOnly, probe)).toString('base64');
  const maxRadius = await page.evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${png}';
    await img.decode();
    const ctx = Object.assign(document.createElement('canvas'), { width: ${probe}, height: ${probe} })
      .getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, ${probe}, ${probe});
    let max = 0;
    for (let y = 0; y < ${probe}; y++)
      for (let x = 0; x < ${probe}; x++)
        if (data[(y * ${probe} + x) * 4 + 3] > 8)
          max = Math.max(max, Math.hypot(x + 0.5 - ${probe / 2}, y + 0.5 - ${probe / 2}));
    return max;
  })()`);
  const safeRadius = (side / 2) * (33 / 54);
  const scale = Math.min(1, safeRadius / ((maxRadius / probe) * side));
  const c = side / 2;
  const foreground = logoOnly
    .replace(
      /(<svg[^>]*>)/,
      `$1<g transform="translate(${c} ${c}) scale(${scale.toFixed(4)}) translate(${-c} ${-c})">`,
    )
    .replace(/<\/svg>\s*$/, '</g></svg>\n');

  const densities = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
  const res = join(root, 'android/app/src/main/res');
  for (const [density, px] of Object.entries(densities)) {
    const dir = join(res, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await render(foreground, px));
  }

  const colors = join(res, 'values/ic_launcher_colors.xml');
  writeFileSync(
    colors,
    readFileSync(colors, 'utf8').replace(
      /(<color name="ic_launcher_background">)#[0-9A-Fa-f]{6}(<\/color>)/,
      `$1${background}$2`,
    ),
  );

  console.log(
    `ícones gerados (fundo ${background}, logo do Android em ${(scale * 100).toFixed(1)}%)`,
  );
} finally {
  await browser.close();
}
