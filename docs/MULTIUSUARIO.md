# Multiusuário no CuePoint

"Multiusuário" aqui quer dizer **outras pessoas instalando o CuePoint**, cada uma com a própria
biblioteca (PRD §4.1, §4.2), e não várias contas dentro do mesmo app. Não há conta nem servidor
(PRD §15): cada instalação cria um `user_id` (UUIDv7) no primeiro uso.

## Isolamento por usuário (implementado na Sprint 15)

**Problema que existia:** a mesclagem (`applyOp`) trabalha por id de registro e tratava `user_id`
como um campo qualquer. Se um aparelho com biblioteca de outro usuário sincronizasse, as duas
bibliotecas se juntavam em silêncio, sem conflito.

**Regras atuais:**

| Onde | Regra |
|---|---|
| Recebimento (extensão `Store.receive`, Android `Store.receive`, serviço do PC `insertOps`, `Replica`) | Um lote com qualquer operação de outro usuário é **recusado inteiro** (`ForeignUserError` / `ForeignUserException`, código `foreign_user`). Vale para o autor (`op.user_id`) e para o campo `user_id` escrito no registro |
| LAN (`POST /v1/sync/push`) | 409 `foreign_user`; o pull também é recusado para par de outro usuário |
| Pareamento (`POST /v1/pair`) | O pedido leva `user_id` e `can_adopt`. Mesmo usuário: segue. Usuário diferente e aparelho vazio (`can_adopt`): o aparelho adota o usuário de quem mostrou o código. Usuário diferente com biblioteca: **recusado** com 409 `foreign_user`, **sem gastar o token** |
| Serviço do PC (`hello`) | Não troca de usuário depois de guardar operações |
| Leituras (extensão `loadSnapshot`, `listResearches`, `listCategories`, `Playlists.list`; Android `Store.all`, `Snapshot.of`) | Só registros do usuário local. Track, TrackCategory e PlaylistTrack não têm dono: a faixa é a mesma para todos (`uuidv5(urn)`) e os vínculos seguem o registro pai |

- Cliente antigo (sem `user_id` no pareamento): o pareamento passa, e a recusa acontece na sync.
- **PC ⇄ PC:** cada extensão cria o próprio usuário. Ao parear com outro PC, se a extensão e o
  serviço deste PC estão vazios, ele adota o usuário do outro (`can_adopt: true` e
  `adoptedUserId` na resposta; a extensão adota junto com `Store.adoptUserIfEmpty`). Com
  biblioteca, o pareamento é recusado.

## Compartilhamento por convite (desenho, sem código)

PRD §4.2: o compartilhamento entre pessoas vem depois, só por convite e autorização explícita.

**Modelo proposto**

- Nova entidade **Library** (`id`, `owner_user_id`, `name`). Hoje cada usuário tem uma biblioteca
  implícita; a migração cria `library_id = user_id` para os dados existentes.
- Researches, Categories, Decisions e Playlists ganham `library_id`. O isolamento passa de "mesmo
  usuário" para "usuário com acesso à biblioteca".
- **Membership** (`library_id`, `user_id`, `role`: `owner` | `editor` | `viewer`, `invited_by`,
  `accepted_at`, `deleted_at`) é uma entidade sincronizada como as outras. Só o dono cria ou revoga.
- As decisões passam a ter autor (`user_id`) dentro da biblioteca, para mostrar "aprovada por
  Fulano" e permitir decisões pessoais numa biblioteca compartilhada.

**Convite**

1. O dono gera um convite (QR/link, uso único, validade curta), como no pareamento: `cuepoint://
   invite?v=1&l=<library>&d=<device>&f=<fp>&k=<pubkey>&t=<token>`.
2. O convidado pareia o aparelho dele com um aparelho do dono e confirma o código de 6 dígitos nos
   dois lados (mesma proteção do pareamento).
3. O dono escolhe o papel; a Membership é criada e sincronizada.
4. A sync troca só as operações das bibliotecas a que cada lado tem acesso. O vetor de versões
   passa a ser por biblioteca, e o filtro do lote recusado inteiro vira "recusar operações de
   bibliotecas sem acesso".

**Revogação:** apaga a Membership (tombstone). Os aparelhos do convidado param de receber e enviar
operações daquela biblioteca. Os dados que já estão com ele continuam lá: sem servidor não há como
apagar à força, e a interface precisa dizer isso.

**Fora do escopo:** contas, nuvem, servidor de convites e permissões por item.

**Perguntas em aberto:** biblioteca compartilhada também compartilha categorias? Exportação para
o SoundCloud continua por pessoa (cada uma com o próprio app e Artist Pro)? Conflitos entre pessoas
diferentes usam a mesma resolução manual?
