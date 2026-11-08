import { expect, openLibrary, test } from './fixtures';
import { openPlayer, routeSoundCloud, setTrack } from './soundcloud-fixture';

const URNS = {
  '/fixture-artist/deep-groove': '111',
  '/other/next-one': '222',
  '/third/rejected-one': '333',
};

test('pesquisa criada na biblioteca aparece no widget e as decisões aparecem na biblioteca', async ({
  context,
}) => {
  await routeSoundCloud(context, URNS);
  const lib = await openLibrary(context);
  await lib.getByLabel('Nome da pesquisa').fill('Latin Bass');
  await lib.getByLabel('Descrição').fill('Graves latinos');
  await lib.getByRole('button', { name: 'Criar pesquisa' }).click();
  await expect(lib.getByTestId('research-list')).toContainText('Latin Bass');

  await lib.getByRole('link', { name: 'Categorias' }).click();
  await lib.getByLabel('Nova categoria').fill('Vocal');
  await lib.getByRole('button', { name: 'Criar' }).click();
  await expect(lib.getByTestId('category-list')).toContainText('Vocal');

  // Classifica no widget
  const player = await openPlayer(context);
  await player.getByTestId('cuepoint-research').selectOption({ label: 'Latin Bass' });
  await player.getByTestId('cuepoint-approve').click();
  await player.getByTestId('cuepoint-category').filter({ hasText: 'Vocal' }).click();
  await expect(player.getByTestId('cuepoint-open-picker')).toHaveText('1 categoria(s)');
  await setTrack(player, { href: '/other/next-one', title: 'Next One', artist: 'Other' });
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Não avaliada');
  await player.getByTestId('cuepoint-approve').click();
  await player.getByTestId('cuepoint-picker-close').click();
  await setTrack(player, { href: '/third/rejected-one', title: 'Rejected One', artist: 'Third' });
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Não avaliada');
  await player.getByTestId('cuepoint-reject').click();
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');

  // Biblioteca reflete as decisões (atualização reativa)
  await lib.bringToFront();
  await lib.getByRole('link', { name: 'Pesquisas' }).click();
  await expect(lib.getByTestId('count-approved')).toHaveText('2');
  await expect(lib.getByTestId('count-rejected')).toHaveText('1');
  await expect(lib.getByTestId('count-pending')).toHaveText('1');

  await lib.getByRole('link', { name: /Latin Bass/ }).click();
  await expect(lib.getByTestId('research-track-row')).toHaveCount(2);
  await lib.getByTestId('category-filter').getByRole('button', { name: 'Vocal' }).click();
  await expect(lib.getByTestId('research-track-row')).toHaveCount(1);
  await expect(lib.getByTestId('research-track-row')).toContainText('Deep Groove');
  await lib.getByTestId('category-filter').getByRole('button', { name: 'Vocal' }).click();
  await expect(lib.getByTestId('research-track-row')).toHaveCount(2);

  await lib.getByRole('tab', { name: /Pendentes/ }).click();
  await expect(lib.getByTestId('research-track-row')).toHaveCount(1);
  await expect(lib.getByTestId('research-track-row')).toContainText('Next One');
  // classifica a pendente pela biblioteca
  await lib.getByRole('button', { name: 'Classificar' }).click();
  await lib.getByTestId('research-track-row').getByRole('button', { name: 'Vocal' }).click();
  await expect(lib.getByTestId('empty-state')).toBeVisible();

  await lib.getByRole('tab', { name: /Rejeitadas/ }).click();
  await expect(lib.getByTestId('research-track-row')).toContainText('Rejected One');
  // Altera a classificação: rejeitada → aprovada
  await lib.getByTestId('research-track-row').getByRole('button', { name: 'Aprovar' }).click();
  await expect(lib.getByTestId('empty-state')).toBeVisible();

  // O widget aberto acompanha a alteração feita na biblioteca
  await player.bringToFront();
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Aprovada');
});

test('visão de músicas mostra decisões por pesquisa e permite editar e arquivar', async ({
  context,
}) => {
  await routeSoundCloud(context, URNS);
  const player = await openPlayer(context);
  for (const name of ['Latin Bass', 'Techno Groovy']) {
    await player.getByTestId('cuepoint-research').selectOption('__new__');
    await player.getByTestId('cuepoint-new-research').fill(name);
    await player.getByRole('button', { name: 'Criar pesquisa' }).click();
    await expect(player.getByTestId('cuepoint-research').locator('option:checked')).toHaveText(
      name,
    );
  }
  await player.getByTestId('cuepoint-reject').click(); // Techno: rejeitada
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Rejeitada');
  await player.getByTestId('cuepoint-research').selectOption({ label: 'Latin Bass' });
  await player.getByTestId('cuepoint-approve').click(); // Latin: aprovada
  await expect(player.getByTestId('cuepoint-decision')).toHaveText('Aprovada');

  const lib = await openLibrary(context, '/tracks');
  const row = lib.getByTestId('track-row').filter({ hasText: 'Deep Groove' });
  await expect(row.getByRole('button', { name: 'Aprovar', pressed: true })).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Rejeitar', pressed: true })).toHaveCount(1);

  // Edita e arquiva uma pesquisa
  await lib.getByRole('link', { name: 'Pesquisas' }).click();
  await lib.getByRole('link', { name: /Techno Groovy/ }).click();
  await lib.getByRole('button', { name: 'Editar' }).click();
  await lib.getByLabel('Nome da pesquisa').fill('Techno Peak');
  await lib.getByRole('button', { name: 'Salvar' }).click();
  await expect(lib.getByRole('heading', { name: 'Techno Peak' })).toBeVisible();
  await lib.getByRole('button', { name: 'Arquivar' }).click();
  await lib.getByRole('link', { name: 'Pesquisas' }).first().click();
  await expect(lib.getByTestId('research-list')).not.toContainText('Techno Peak');
  await lib.getByLabel(/Mostrar arquivadas/).check();
  await expect(lib.getByTestId('research-list')).toContainText('Techno Peak');
});
