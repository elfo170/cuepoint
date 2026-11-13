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

## Compartilhamento entre pessoas

**Não será implementado** (decisão do usuário, 12/11/2026). Cada pessoa usa a própria biblioteca;
o PRD (§4.1, §4.2) deixava o compartilhamento por convite como possibilidade futura, e ela foi
descartada: sem nuvem, a sincronização só acontece na rede local, e o uso do CuePoint é individual.
