import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, launchWithExtension, openLibrary, serviceWorker, test } from './fixtures';
import { openPlayer, routeSoundCloud, setTrack } from './soundcloud-fixture';

const URNS = { '/fixture-artist/deep-groove': '111', '/other/next-one': '222' };

async function seedTwoApproved(context: Parameters<typeof routeSoundCloud>[0]) {
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
  return player;
}

test('cria playlist a partir de uma pesquisa, reordena e remove itens', async ({ context }) => {
  await seedTwoApproved(context);
  const lib = await openLibrary(context, '/playlists');
  await lib.getByLabel('Nome da playlist').fill('Set Latin');
  await lib.getByLabel('Origem: pesquisa').selectOption({ label: 'Aprovadas em Latin Bass' });
  await lib.getByRole('button', { name: 'Criar playlist' }).click();
  await expect(lib.getByTestId('playlist-list')).toContainText('2 música(s)');
  await lib.getByRole('link', { name: /Set Latin/ }).click();

  const titles = lib.getByTestId('playlist-item').getByTestId('track-title');
  await expect(titles).toHaveText(['Deep Groove', 'Next One']);
  await lib.getByTestId('playlist-item').nth(1).getByRole('button', { name: 'Subir' }).click();
  await expect(titles).toHaveText(['Next One', 'Deep Groove']);
  await lib
    .getByTestId('playlist-item')
    .nth(0)
    .getByRole('button', { name: 'Remover da playlist' })
    .click();
  await expect(titles).toHaveText(['Deep Groove']);

  // adicionar de volta pela busca
  await lib.getByLabel('Adicionar música').fill('next');
  await lib.getByRole('button', { name: /Next One/ }).click();
  await expect(titles).toHaveText(['Deep Groove', 'Next One']);

  const download = lib.waitForEvent('download');
  await lib.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('Set Latin.csv');
});

test('backup manual gera arquivo válido e a restauração recupera a biblioteca', async () => {
  const context = await launchWithExtension();
  await seedTwoApproved(context);
  const lib = await openLibrary(context, '/backup');
  await lib.getByRole('button', { name: 'Fazer backup agora' }).click();
  await expect(lib.getByTestId('backup-message')).toContainText(
    'CuePoint/backups/cuepoint-backup-',
  );
  await expect(lib.getByTestId('backup-history').locator('li')).toHaveCount(1);

  // Localiza o arquivo baixado pelo chrome.downloads
  const sw = await serviceWorker(context);
  const file = await expect
    .poll(
      async () =>
        sw.evaluate(async () => {
          const [d] = await chrome.downloads.search({ orderBy: ['-startTime'] });
          return d?.state === 'complete' ? d.filename : null;
        }),
      { timeout: 10_000 },
    )
    .not.toBeNull()
    .then(() =>
      sw.evaluate(
        async () => (await chrome.downloads.search({ orderBy: ['-startTime'] }))[0]!.filename,
      ),
    );
  const content = readFileSync(file, 'utf8');
  expect(JSON.parse(content)).toMatchObject({ format: 'cuepoint-backup', version: 1 });
  await context.close();

  // Restaura num perfil novo
  const fresh = await launchWithExtension();
  const lib2 = await openLibrary(fresh, '/backup');
  // arquivo corrompido é recusado
  const corrupted = join(tmpdir(), `cuepoint-corrupted-${Date.now()}.json`);
  writeFileSync(corrupted, content.replace('Latin Bass', 'Latin Bas'));
  await lib2.getByTestId('restore-input').setInputFiles(corrupted);
  await expect(lib2.getByTestId('backup-message')).toContainText('Checksum não confere');

  const valid = join(tmpdir(), `cuepoint-valid-${Date.now()}.json`);
  writeFileSync(valid, content);
  await lib2.getByTestId('restore-input').setInputFiles(valid);
  await expect(lib2.getByTestId('restore-preview')).toContainText('2 músicas');
  await lib2.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(lib2.getByTestId('backup-message')).toHaveText('Biblioteca restaurada.');

  await lib2.getByRole('link', { name: 'Pesquisas' }).click();
  await expect(lib2.getByTestId('count-approved')).toHaveText('2');

  // O widget usa a biblioteca restaurada (pesquisa ativa incluída)
  await routeSoundCloud(fresh, URNS);
  const player = await openPlayer(fresh);
  await expect(player.getByTestId('cuepoint-research').locator('option:checked')).toHaveText(
    'Latin Bass',
  );
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
  await fresh.close();
});
