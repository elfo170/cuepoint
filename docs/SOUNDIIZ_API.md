# Exportação via Soundiiz no CuePoint

Alternativa para quem **não tem Artist Pro** (Issue #4): o CuePoint envia a lista de faixas à API
pública de importação do Soundiiz, que devolve um link temporário. No Soundiiz, o usuário revisa as
correspondências e transfere a playlist para o SoundCloud. Decisões e sprints: seção *Nova feat:
exportação via Soundiiz* do [PLANEJAMENTO.md](../PLANEJAMENTO.md).

A forma do pedido e a leitura da resposta são definidas uma vez em
`packages/core/src/soundiiz.ts`. A paridade com o app Android é conferida por
`spec/vectors/soundiiz.json`.

> ⚠️ **A correspondência das faixas pode errar.** A API não aceita identificadores do SoundCloud,
> então o Soundiiz procura cada faixa pelo título e pelo artista. O usuário precisa revisar a lista
> no Soundiiz antes de transferir. O CuePoint não corrige falsos positivos.

## Contrato da API

Fonte: artigo
[[API] Let your users import any tracklist to Soundiiz](https://support.soundiiz.com/hc/en-us/articles/36613501259922--API-Let-your-users-import-any-tracklist-to-Soundiiz),
atualizado em 04/11/2026 e conferido em 13/11/2026.

- A página devolve 403 para acesso automatizado.
- Para ler o texto, usar a API pública do Zendesk:
  `https://support.soundiiz.com/api/v2/help_center/en-us/articles/36613501259922.json` (campo
  `article.body`).

**Pedido:** `POST https://soundiiz.com/go/import-playlist`, `Content-Type: application/json`.
Não exige API key nem assinatura do Soundiiz.

| Campo | Obrigatório | O que o CuePoint envia |
|---|---|---|
| `title` | sim | Nome da playlist |
| `tracklist` | sim, de 1 a 200 faixas | Faixas na ordem da playlist |
| `tracklist[].title` | sim | Título da faixa |
| `tracklist[].artists` | não (string ou lista) | `[artista]`; omitido quando vazio |
| `tracklist[].album`, `isrc` | não | Nunca: o CuePoint não os tem, e o artigo pede para não chutar |
| `sourceName` | não | `CuePoint` |
| `sourceLogo` | não | Omitido: não há URL pública estável do logo |
| `description` | não | Descrição da playlist ou "Playlist exportada do CuePoint" |
| `destination` | não | `soundcloud`: o Soundiiz pula a escolha de destino |

**Destino.**
- Um `destination` vazio, inválido ou sem suporte dá **400**. Não há volta para a escolha manual.
- Há 38 destinos na lista de 02/11/2026. `soundcloud` está entre eles.

**Respostas.**
- **Sucesso:** `{"status":"success","nbTracks":3,"shareUrl":"https://soundiiz.com/go/import-playlist/<32 hex>","expiresAt":<unix>}`.
  O link vale 24 h.
- **Erro:** `{"status":"error","message":"…"}`.
  - Mensagens documentadas: JSON inválido, sem `title`, `tracklist` vazia, faixa sem título no
    índice N, mais de 200 faixas, destino inválido.
  - Interpretação no core (`soundiizParseResponse`):

    | Resposta | Código |
    |---|---|
    | 400 | `invalid`, com a mensagem do Soundiiz |
    | 429 e 5xx | `unavailable` |
    | Outra resposta | `http` |
    | Sucesso com link fora de `https://soundiiz.com/` | `http`: o link não é aberto |

**O que o endpoint não faz.**
- Não cria a playlist na conta do usuário. Cria só a página temporária de revisão.
- Os limites do plano do Soundiiz continuam valendo na transferência.

## Resultados da PoC (Sprint 17)

Script: `node packages/helper/scripts/soundiiz-poc.mjs --help`.
- Lê a biblioteca do `helper.db` **só para leitura** (ou um JSON exportado pela extensão) e monta o
  pedido pelo core.
- A variante B (`--split`) divide "Artista - Música" do título em artista e título.
- As playlists de teste, com prefixo `[Teste Soundiiz]`, existem só no pedido enviado ao Soundiiz.
  Nada foi criado na biblioteca.

### Pedidos à API (16/11/2026)

| Playlist | Faixas | Resultado |
|---|---|---|
| House (real) | 21 | ✔ `nbTracks=21` |
| teste (real) | 3 | ✔ `nbTracks=3` |
| [Teste Soundiiz] todas as 76 faixas (biblioteca inteira) | 76 | ✔ `nbTracks=76` |
| [Teste Soundiiz] Ação & "aspas" / barra — 🎧 (faixas com acentos, emoji e símbolos) | 10 | ✔ `nbTracks=10`; título com caracteres especiais aceito |
| [Teste Soundiiz] 1 faixa | 1 | ✔ `nbTracks=1` |
| [Teste Soundiiz] 200 faixas (faixas reais repetidas em ciclo) | 200 | ✔ `nbTracks=200` |
| [Teste Soundiiz] artista vazio (sem `artists`) | 3 | ✔ `nbTracks=3` |
| House, variante B | 21 | ✔ `nbTracks=21` |
| todas as 76, variante B | 76 | ✔ `nbTracks=76` |
| [Teste Soundiiz] 201 faixas (`--force`) | 201 | ✘ 400 "Invalid tracklist. Your tracklist must include at least 1 track and up to 200 tracks." |
| [Teste Soundiiz] vazia (`--force`) | 0 | ✘ 429: limite de requisições (ver abaixo) |

- Nos envios aceitos, `nbTracks` sempre bateu com o número de faixas enviadas.
- Duplicatas também contam: no pedido de 200, as 76 faixas foram repetidas em ciclo.

### Limite de requisições (não documentado)

- Depois de **10 pedidos aceitos em cerca de 3 segundos**, a API passou a responder **429**:
  `{"status":"error","message":"Too many requests. Please try again later."}`.
- O primeiro 429 veio às 18:45:53. Às 18:46:43 a API ainda recusava, e às **18:48:43** voltou a
  aceitar. O bloqueio durou entre 1 e 3 minutos.

**Consequências para a implementação:**
- um pedido por clique;
- sem novas tentativas automáticas;
- o 429 aparece como "Soundiiz indisponível no momento, tente mais tarde".

### CORS

- O preflight (`OPTIONS`) responde 200 **sem** `Access-Control-Allow-*`. As respostas ao `POST`
  também vêm sem esse cabeçalho.
- Teste numa página da extensão (`library.html`), com Playwright e um perfil temporário:

  | `host_permissions` | Resultado |
  |---|---|
  | **sem** `https://soundiiz.com/*` | `TypeError: Failed to fetch` |
  | **com** `https://soundiiz.com/*` | O pedido chega à API: veio o 429 do limite acima, com o corpo JSON lido normalmente |

- Conclusão: a extensão chama a API direto, desde que declare `https://soundiiz.com/*` em
  `host_permissions`. Não precisa de backend nem do serviço do PC.
- O Android (OkHttp) não sofre CORS.

### Correspondências (avaliação do usuário, 16/11/2026)

- **Links:** os links gerados abriram no Soundiiz com o SoundCloud como destino.
- **Variantes A e B:** o usuário viu resultados iguais nas duas, nas playlists House e "todas".
  - A variante B não trouxe ganho, então **fica a A**: título e artista como estão no CuePoint.
  - A divisão "Artista - Música" não entra na implementação.
- **Transferência:** a importação para o SoundCloud foi concluída pelo fluxo do Soundiiz.
- **Ainda não registrado:**
  - a contagem de faixas certas, erradas e não encontradas;
  - se a conta do SoundCloud usada era gratuita;
  - se o Soundiiz exigiu conta própria.
  - Conferir na validação real da Sprint 18.

**O que se espera dos metadados do SoundCloud** (dry-run da biblioteca real):
- O "artista" costuma ser quem publicou (`Mixmag premiere`, `Hugues`, um selo), às vezes com
  vários nomes numa string só (`DJ DOLLHOUSE, AKEYLAH`).
- O título costuma trazer o artista real ("Underworld - Born Slippy (Céleste Sunrise Mix)") e
  ruído como `PREMIERE:`, `[Free DL]` ou o código do lançamento.
- A variante B ajuda quando o título é "Artista - Música" e atrapalha com prefixos ("PREMIERE:
  Anna Kost" vira artista).

## Limitações

- **Precisão:** a correspondência depende de título e artista. Falsos positivos (outra versão,
  outro remix) só são percebidos na revisão do usuário.
- **Até 200 faixas por pedido.** Acima disso, o CuePoint bloqueia o envio e avisa.
- **Link de 24 h.** Gerar outro é só exportar de novo. O CuePoint não guarda nada do Soundiiz.
- **Limite de requisições** não documentado (ver acima).
- **Plano do Soundiiz:**
  - a transferência pode exigir uma conta no Soundiiz;
  - no plano gratuito, as playlists são transferidas uma de cada vez, com até 200 faixas cada;
  - os limites são do Soundiiz e podem mudar.
- **Dados enviados a um terceiro:**
  - vão para o Soundiiz o nome e a descrição da playlist e o título e o artista de cada faixa;
  - não vão URN, link, tokens nem dados de outras playlists;
  - o envio só acontece por clique do usuário.
