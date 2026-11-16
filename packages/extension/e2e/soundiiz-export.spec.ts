import { expect, openLibrary, test } from './fixtures';
import { openPlayer, routeSoundCloud, setTrack } from './soundcloud-fixture';

const SHARE = 'https://soundiiz.com/go/import-playlist/0123456789abcdef0123456789abcdef';
const URNS = { '/fixture-artist/deep-groove': '111', '/other/next-one': '222' };

test('exporta via Soundiiz: envia a playlist na ordem e abre o link', async ({ context }) => {
  await routeSoundCloud(context, URNS);
  const player = await openPlayer(context);
  await player.getByTestId('cuepoint-research').selectOption('__new__');
  await player.getByTestId('cuepoint-new-research').fill('Latin Bass');
  await player.getByRole('button', { name: 'Criar pesquisa' }).click();
  await player.getByTestId('cuepoint-approve').click();
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await setTrack(player, { href: '/other/next-one', title: 'Next One', artist: 'Other' });
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Não avaliada');
  await player.getByTestId('cuepoint-approve').click();
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Aprovada');

  // A API real nunca é chamada no e2e
  const sent: unknown[] = [];
  await context.route('https://soundiiz.com/go/import-playlist', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        nbTracks: 2,
        shareUrl: SHARE,
        expiresAt: 1782220923,
      }),
    });
  });
  await context.route(`${SHARE}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Soundiiz</title>' }),
  );

  const lib = await openLibrary(context, '/playlists');
  await lib.getByLabel('Nome da playlist').fill('Set Latin');
  await lib.getByLabel('Origem: pesquisa').selectOption({ label: 'Aprovadas em Latin Bass' });
  await lib.getByRole('button', { name: 'Criar playlist' }).click();
  await lib.getByRole('link', { name: /Set Latin/ }).click();
  await lib.getByTestId('playlist-item').nth(1).getByRole('button', { name: 'Subir' }).click();
  await expect(lib.getByTestId('playlist-item').getByTestId('track-title')).toHaveText([
    'Next One',
    'Deep Groove',
  ]);

  const card = lib.getByTestId('soundiiz-export-card');
  await expect(card).toContainText('SoundCloud via Soundiiz');
  // o cartão Artist Pro continua lá
  await expect(lib.getByTestId('sc-export-card')).toBeVisible();

  const tab = context.waitForEvent('page');
  await card.getByTestId('soundiiz-export').click();
  expect((await tab).url()).toBe(SHARE);
  await expect(card.getByRole('status')).toContainText('Link criado com 2 música(s)');

  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    title: 'Set Latin',
    sourceName: 'CuePoint',
    destination: 'soundcloud',
    tracklist: [{ title: 'Next One', artists: ['Other'] }, { title: 'Deep Groove' }],
  });

  // CSV continua igual
  const download = lib.waitForEvent('download');
  await lib.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('Set Latin.csv');
});
