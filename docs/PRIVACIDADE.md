# Política de privacidade do CuePoint

Última atualização: 11/11/2026.

O CuePoint é um programa de curadoria musical que roda nos seus aparelhos (extensão do Chrome,
serviço do PC no Windows e app Android). Não existe servidor do CuePoint: nenhum dado seu vai para
o autor do programa.

## O que fica nos seus aparelhos

- **Biblioteca:** pesquisas, decisões, categorias, playlists e os dados das faixas (título, artista,
  link e identificador do SoundCloud, capa). Fica no navegador (IndexedDB), no serviço do PC e no
  app, e só é trocada entre os **seus** aparelhos pareados, pela rede local, com conexão cifrada.
- **Backups:** arquivos JSON que você gera, na pasta que escolher.
- **Exportação para o SoundCloud** (opcional, exige Artist Pro): o código e a senha do app que
  **você** registrou no SoundCloud e os tokens de acesso ficam no serviço do PC, cifrados com a sua
  conta do Windows. Não entram na sincronização. Se você usar **Enviar para o celular**, o código e
  a senha do app vão uma única vez para o seu celular pareado, pela conexão cifrada do pareamento.

## O que é enviado ao SoundCloud

Só quando você usa a exportação, e só depois de um clique seu:

- o nome, a descrição e as faixas (identificadores) da playlist que você exporta ou atualiza;
- os pedidos de login, renovação de acesso e desconexão;
- os links de faixas sem identificador, para o SoundCloud dizer qual é a faixa.

O CuePoint guarda do SoundCloud apenas o identificador da playlist exportada, para poder
atualizá-la depois. O nome da sua conta é mostrado na tela e não é gravado.

## Leitura no celular

O app Android lê a sessão de mídia do app do SoundCloud (título, artista e identificador da faixa
que está tocando), pelo acesso às notificações que você autoriza. Nada disso sai do aparelho, a não
ser para os seus aparelhos pareados.

## Seus controles

- **Desconectar** (Configurações → Exportar para o SoundCloud) revoga o acesso no SoundCloud e
  apaga os tokens na hora. **Remover credenciais** apaga também o código e a senha do app.
- Você também pode revogar o acesso em soundcloud.com, nas configurações de apps conectados.
- Desinstalar a extensão, o serviço do PC ou o app apaga os dados locais de cada um
  (`%LOCALAPPDATA%\CuePoint` guarda os do serviço do PC).

## Contato

Dúvidas e pedidos: abra uma issue em https://github.com/elfo170/cuepoint/issues.
