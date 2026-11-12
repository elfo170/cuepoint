# CuePoint — Planejamento

Referência de produto: [CuePoint_PRD_v1.0.md](CuePoint_PRD_v1.0.md).

## Contexto

A **v1.0 está pronta e distribuída** (extensão Chrome, serviço do PC e app Android; notas em
`docs/releases/v1.0.md`). As Sprints 0–14 estão concluídas e commitadas: o histórico está no
`git log` e no código. Este documento guarda só o que ainda vale para as próximas etapas.

**Regras de trabalho:** um commit por sprint/correção, Conventional Commits em pt-BR, e cada etapa
só começa com autorização do usuário.

**Fatos que não podem ser esquecidos:**
- A **biblioteca do PC (Chrome) tem dados reais**: nunca apagar nem restaurar por cima sem pedido
  explícito.
- O celular (Redmi Note 14 Pro 5G, HyperOS 2, Android 15) está pareado com o PC, política "pedir
  aprovação" nos dois lados.

## Próximas etapas

| Etapa | Situação |
|---|---|
| Issue #1 — notificação reaparece após bloquear a tela | Concluída: PR #2 e release v1.0.1 (só o APK; notas em `docs/releases/v1.0.1.md`). Ver *Issue #1*. |
| Sprint 15 — Exportação para o SoundCloud pelo PC e isolamento por usuário | Concluída (11/11/2026): commit no branch `feat/api-sc`, validada com a API real e no PC do usuário. Push feito; falta o PR para `main`. Ver *Sprint 15*. |
| Sprint 16 — SoundCloud no celular | Planejada (12/11/2026) em quatro sprints, 16.1 a 16.4, um commit cada, sem push. 16.1, 16.2 e 16.3 concluídas (OpenAPI reconferida em 12/11/2026, sem mudanças); checkpoints manuais pendentes na tabela abaixo. Ver *Sprint 16*. |
| Análise de notificações em foco (HyperOS) | Adiada. Ver *Notificação do Android*. |
| Publicação nas lojas (lembrete) | Mapear: extensão na Chrome Web Store e APK na Play Store. Viabilidade ainda não analisada. |

## Premissas

| Tema | Decisão |
|---|---|
| Banco no PC | IndexedDB (Dexie 4) dentro da extensão |
| Monorepo | npm workspaces (Node 22.16 / npm 10.9) |
| Toolchain web | Vite + `@crxjs/vite-plugin` 2.x, Vitest, Playwright, ESLint + Prettier |
| Serviço auxiliar | Node 22 (`node:sqlite`), Native Messaging + HTTPS na LAN + mDNS |
| Android | Kotlin + Compose + Room. AGP 8.7.3, Kotlin 2.0.21, KSP 2.0.21-1.0.28, Gradle 8.11.1, compile/target 35, minSdk 26, Compose BOM 2024.12.01, Room 2.6.1 |
| Pacote Android | `com.elfo170.cuepoint` |
| Fora do escopo | Tudo o que está no §15 do PRD (player próprio, IA, BPM/tom, atalhos, nuvem, conta obrigatória) |

## Ambiente

- Android SDK: `C:/Users/Leo/AppData/Local/Android/Sdk` (android-35).
- JDK: JBR do Android Studio em `C:\Program Files\Android\Android Studio\jbr`. O `java` do sistema
  é 1.8 e não serve para o AGP, por isso o build Android roda com `JAVA_HOME` apontando para o JBR.
- Remote `origin` = github.com/elfo170/cuepoint.

## Arquitetura (o que a Sprint 15 toca)

### Modelo de dados

- Entidades do PRD (§6.1) com `deleted_at` (tombstone), mapa de versão por campo (HLC), `archived`
  em Researches e `position` em PlaylistTracks (chave fracionária).
- **IDs:** UUIDv7 por padrão; UUIDv5 determinístico onde dispositivos podem criar "a mesma coisa"
  de forma independente: Track com URN (`uuidv5(urn)`), Decision (`track_id:research_id`),
  TrackCategory (`track:research:category`), PlaylistTrack (`playlist:track`).
- **"Não avaliada"** é a ausência da Decision (ou a Decision com tombstone).
- **SyncEvents = log de operações:** `op_id`, `origin_device_id`, `seq`, `hlc`, `entity_type`,
  `entity_id`, `operation` (`put` | `delete`), campos, `base` (versão de cada campo que o autor viu)
  e `synchronization_status`. Cada escrita grava a entidade e a operação na mesma transação. Nada é
  apagado automaticamente.
- **Mesclagem por campo:**
  - `base` igual à versão local: aplica.
  - Valor recebido igual ao local: só atualiza a versão.
  - Concorrentes e diferentes: registra um **conflito** com os dois valores. Até o usuário
    resolver, vale o de maior HLC, para todas as réplicas mostrarem o mesmo valor.
  - A resolução é uma nova operação que domina as duas versões. Exclusão é um campo como outro
    qualquer, então "editar × excluir" também vira conflito.
- **Entrega causal:** as réplicas trocam vetores de versão `{origin_device → seq}` e enviam as
  operações de todas as origens, ordenadas por HLC (idempotência por `op_id`, retransmissão A→B→C).

### Pareamento e segurança

- Cada dispositivo tem um par **ECDSA P-256** e um **certificado TLS autoassinado**.
- Transporte HTTPS com o certificado do servidor fixado (SPKI SHA-256).
- Toda requisição é assinada sobre `método\ncaminho\ntimestamp\nnonce\nsha256(corpo)`, com janela de
  tempo e cache de nonces contra replay. Dispositivo revogado é recusado na hora.
- **QR de uso único (5 min):** `cuepoint://pair?v=1&d=<id>&n=<nome>&a=<ip:porta,…>&f=<fp>&k=<pubkey>&t=<token>`.
  O QR não transporta a biblioteca. Os dois lados mostram um código de 6 dígitos (SAS) que o usuário
  confirma, e então define a política do par: aprovação a cada sync (padrão) ou automática.
- **Revogação:** remove a confiança no par, invalida as credenciais e avisa o par (melhor esforço).

### Protocolo de sync

- Descoberta por mDNS/DNS-SD `_cuepoint._tcp`; sem ela, últimos endereços conhecidos ou endereço
  digitado.
- Endpoints: `GET /v1/hello`, `POST /v1/pair`, `POST /v1/sync/pull {vv}`, `POST /v1/sync/push {ops}`,
  `POST /v1/revoke`. JSON + gzip, paginados.
- Política por par: `auto` sincroniza sozinho; `ask` pede aprovação (no Android, por notificação).
  Se ninguém puder aprovar, a sync fica adiada, nunca descartada.
- Gatilhos: ao descobrir um par, após alterações locais (debounce) e periodicamente (WorkManager,
  15 min, no Android). Cada execução fica em `sync_runs`.
- Operações pendentes do mesmo registro que nenhum outro aparelho recebeu são compactadas antes do
  envio.

## Sprint 15 — P3: Exportação para o SoundCloud (PC) e isolamento por usuário

Escopo (decidido em 11/11/2026): **assistente na extensão + OAuth e exportação pelo serviço do PC**,
isolamento por `user_id` e documentação. A parte do celular fica na **Sprint 16**. O plano de
execução está em *Plano da Sprint 15*, depois das decisões.

- Com credenciais OAuth de app: exportar playlist interna para o SoundCloud, inclusive atualizar
  uma playlist já publicada (PKCE; troca e renovação do token pelo serviço do PC, ver *Decisões*).
- Sem credenciais: **nenhuma operação via API** (PRD §11.2); ficam só os exports locais.
- Isolamento por `user_id` aplicado nos repositórios e na sync (operações de outro usuário são
  recusadas), com testes.
- `docs/SOUNDCLOUD_API.md`, `docs/PRIVACIDADE.md` e `docs/MULTIUSUARIO.md` (desenho do
  compartilhamento por convite).
- **Credenciais do autor:** criadas em 11/11/2026 (app `CuePoint` na conta Artist Pro do usuário).
  - Ficam no `.env` da raiz, ignorado pelo Git, como `SC_CLIENT_ID` e `SC_CLIENT_SECRET`.
  - **Nunca usar o prefixo `VITE_`**, que levaria o valor para a extensão compilada.
  - O `.env` serve só para desenvolvimento e testes. Na versão distribuída, cada usuário informa as
    próprias credenciais pelo assistente.
- **Pronto quando:** testes de isolamento e do módulo SoundCloud passam (TS, serviço do PC, Kotlin e
  vetores), exportação e atualização reais conferidas pelo usuário e documentação completa.
- Commit: `feat: exporta playlists para o soundcloud e isola os dados por usuário`

> ⚠️ **A exportação para o SoundCloud só funciona para quem tem Artist Pro.** Sem nuvem (PRD §15),
> cada pessoa que usa o CuePoint registra o **próprio** app no SoundCloud, e registrar exige Artist
> Pro. Isso precisa ficar evidente na interface, no código e na documentação de instalação.

### Prompt inicial da integração (11/11/2026)

Instruções fornecidas pelo usuário para integrar a API do SoundCloud, registradas na íntegra:

```text
You are helping integrate the SoundCloud API.

Authoritative technical sources (use these; do not invent endpoints or headers):
- OpenAPI spec JSON: https://developers.soundcloud.com/docs/api/explorer/api.json
- OpenAPI spec YAML (GitHub): https://github.com/soundcloud/api/blob/master/openapi/api.yaml
- API Guide (auth, uploads, playback, pagination, errors): https://developers.soundcloud.com/docs/api/guide
- API credentials CLI (use this before a browser flow): curl -fsSL https://raw.githubusercontent.com/soundcloud/api/master/scripts/sc-api-auth.mjs | node --input-type=module - --remote --name "My API App" --description "What my integration does" --website "https://example.com"
- Register app / credential guidance (Artist Pro, Client ID & secret): https://developers.soundcloud.com/docs/api/register-app
- LLM-oriented overview: https://developers.soundcloud.com/docs/llm-context
- API Explorer (interactive browsing only, not endpoint discovery): https://developers.soundcloud.com/docs/api/explorer/open-api

Rules:
1. Parse the OpenAPI JSON before selecting an endpoint. Use the API Explorer only to try or inspect an endpoint after finding it in the spec.
2. Base URL for API calls: https://api.soundcloud.com. Token endpoint host: https://secure.soundcloud.com
3. Authentication is OAuth 2.1; PKCE is required for the authorization code flow. Prefer the flows and parameters described in the API Guide.
4. Send access tokens on API requests using the header: Authorization: OAuth <access_token> (unless the spec documents a different requirement for a specific endpoint).
5. Access tokens expire after roughly one hour. Refresh tokens are single-use; implement refresh without infinite retry loops. Refreshing and reusing tokens until they are close to expiry avoids unnecessary token exchanges that can hit rate limits on new-token requests.
6. Client Credentials token exchange is rate-limited (per app and per IP). Cache access tokens; renew with the refresh_token grant instead of requesting new client_credentials tokens on every startup or request.
7. Respect rate limits (including play-stream limits). On HTTP 429, back off exponentially and surface errors clearly.
8. Many list endpoints support pagination with linked_partitioning=true and a next_href field; follow it until absent.
9. Not all tracks are playable for every client; handle preview/blocked/streamable states as documented.
10. Never hardcode client_id, client_secret, or tokens; load them from environment variables or a secrets manager.
11. Comply with the SoundCloud API Terms of Use and attribution/branding requirements when shipping a product.
```

### Descobertas (brainstorming de 11/11/2026, sem código)

Fontes lidas: OpenAPI (`api.json`, OpenAPI 3.0.4), API Guide, Get an API key, Terms of Use, Rate
limits, Credential rotation, LLM Context e o código do `sc-api-auth.mjs`. "Multiusuário" aqui quer
dizer **outras pessoas instalando o CuePoint**, não várias contas dentro do app.

**Endpoints (conferidos na OpenAPI):**

| Necessidade | Endpoint | Observação |
|---|---|---|
| Criar playlist | `POST /playlists` | JSON `{"playlist":{"title","description","sharing":"public"\|"private","tracks":[{"urn":"soundcloud:tracks:N"}]}}` |
| Atualizar playlist | `PUT /playlists/{playlist_urn}` | Mesmo corpo. Não documentado se a lista de faixas enviada substitui a anterior |
| Ler playlist | `GET /playlists/{urn}`, `GET /me/playlists`, `GET /playlists/{urn}/tracks` | Paginação `linked_partitioning` + `next_href` |
| Conta conectada | `GET /me` | Mostrar "Conectado como @…" |
| Link → URN | `GET /resolve?url=` | Para faixas sem URN |
| Desconectar | `POST /disconnect` | Revoga só os tokens do app (204) |
| Disponibilidade | campo `access`: `playable`, `preview`, `blocked` | |

- A OpenAPI identifica faixas por **URN** (`{"urn": ...}`), o mesmo formato que o CuePoint já guarda;
  o exemplo do Guide usa `{"id": N}`. Vale a OpenAPI.
- Autenticação: `https://secure.soundcloud.com/authorize` e `https://secure.soundcloud.com/oauth/token`,
  header `Authorization: OAuth <token>`. Não há escopos. O access token dura cerca de 1 h. O refresh
  token é de uso único, e a validade dele não é documentada.

**Artist Pro e o secret:**
- O Artist Pro é exigido do **dono do app** (registrar e clonar credenciais). Nenhuma página exige
  plano do **usuário final** para autorizar o app ou criar e editar playlists.
- A troca e a renovação do token **exigem `client_secret` mesmo com PKCE** ("all clients are
  currently treated as confidential").
- O secret não pode ficar em código do lado do cliente nem ser repassado a terceiros. Os Termos
  proíbem usar o client_id de outra pessoa "a menos que trabalhem no mesmo app".
- Consequência: um app único do autor, distribuído a todos, exigiria um servidor guardando o secret
  (nuvem, fora do escopo) ou exporia o secret (proibido).
- Não documentado: o que acontece com as credenciais se o Pro do dono vencer.

**Termos e limites:**
- Limites de requisição **por client_id**, na ordem de 100 requisições por minuto no geral, sujeitos
  a mudança. Sem limite documentado para escrita de playlist.
- O stream não é usado pelo CuePoint. A LLM Context diz 15.000 requisições por dia e a página Rate
  limits diz 1.500.
- Ações só iniciadas deliberadamente pelo usuário.
- Botão de desconectar obrigatório; dados apagados em até 7 dias após desconectar.
- Política de privacidade obrigatória.
- Proibido armazenar "User Content" vindo da API de forma persistente.
- Nome do app sem a marca SoundCloud; sem anúncios em torno de conteúdo de usuários.
- Não documentados: limite de faixas por playlist; se dá para incluir faixas de outros artistas ou
  `blocked`; regras de endereço de retorno para extensão do Chrome (`chromiumapp.org`).

**Script oficial `sc-api-auth.mjs`:**
- O modo `--remote` cria um código de pareamento, mostra
  `https://secure.soundcloud.com/activate/<código>` (abre em qualquer aparelho), consulta até a
  aprovação e então cria o app (`POST /me/apps`) ou devolve o já existente.
- O retorno inclui `client_id` e `client_secret`.
- `update-redirect` altera o endereço de retorno e só aceita URL absoluta `http`/`https`.
- `clone` (máx. 3 credenciais por app) e `revoke` também existem.
- Usa rotas não documentadas (`api-reg.soundcloud.com/pairing/...`, `/me/apps`) e um client_id do
  próprio SoundCloud descrito como "Scoped to this tool only". O próprio login local do script usa
  `http://127.0.0.1:8765/callback`.

### Decisões (aprovadas pelo usuário em 11/11/2026)

| Opção | Quem precisa de Pro | Decisão |
|---|---|---|
| A. Cada pessoa registra o próprio app e informa as credenciais no CuePoint | **Cada usuário** | **Adotada** |
| B. Servidor do autor guarda um secret único | Só o autor | Fora do escopo (nuvem, PRD §15) |
| C. Secret do autor embutido na extensão, no serviço ou no APK | Só o autor | **Proibida** pelos termos |

**Assistente para quem não é dev (extensão + serviço do PC):**
1. O cartão "Exportar para o SoundCloud" exibe o selo **"Requer Artist Pro"** e pergunta antes de
   tudo. Sem Pro: o CuePoint explica e oferece os exports locais.
2. "Criar sua chave": abre `soundcloud.com/you/apps` e mostra o que preencher (nome, descrição e
   endereço de retorno, cada um com **Copiar**; sem prints, decidido em 11/11/2026).
3. A pessoa cola "Código do app" (client_id) e "Senha do app" (secret, mascarado), com o aviso de que
   ficam só no aparelho. A extensão repassa ao serviço do PC e não guarda.
4. Validação imediata, com erros em linguagem simples.
5. "Entrar com SoundCloud" (PKCE). O retorno vai para o serviço do PC. Ao final, "Conectado como @…".
6. Renovação automática. Credenciais inválidas (por exemplo, Pro vencido): avisar e mostrar
   **Reconectar**, sem repetir em loop.
7. Botão **Desconectar** (`/disconnect` + apagar tokens).

**Aparelhos:**
- **Criação do app:** fluxo principal **no PC**, onde é mais confortável copiar e colar.
- **Celular independente:** recebe as credenciais **uma vez pelo canal de pareamento**, criptografado.
  - **Nunca pela sync normal**, que replica e guarda histórico.
  - Guarda com o Android Keystore. Faz o **próprio login** e exporta **sem precisar do PC ligado**.
- **Tokens por aparelho:** cada um tem os seus, nunca compartilhados (o refresh token é de uso único).
- **O que sincroniza:** só o URN da playlist exportada, para PC e celular atualizarem a mesma
  playlist.
- **Endereço de retorno:** o mesmo endereço local nos dois, `http://127.0.0.1:47801/callback`.
  - **O SoundCloud aceitou esse endereço no cadastro do app** (11/11/2026).
  - A porta 47801 fica ao lado da 47800, que o serviço do PC usa na rede local.
  - No PC, quem atende é o serviço do PC. No celular, um servidor local que o app abre só durante o
    login.
  - Hipótese: um único endereço de retorno por app. `cuepoint://` provavelmente não é aceito.
- **Criar o app só pelo celular:** alternativa, se `soundcloud.com/you/apps` funcionar bem no
  navegador do celular.

**Regras:**
- Credenciais são **do usuário**: nada de client_id ou secret no repositório nem no build (regra 10
  do prompt).
- Guardar da API só o URN da playlist exportada.
- **Não** automatizar "Adicionar à playlist" na página do SoundCloud para quem não tem Pro (termos do
  site). Para essas pessoas, melhorar os exports locais.
- **Não** usar o fluxo de pareamento do `sc-api-auth.mjs` para criar o app automaticamente (rotas
  não documentadas e client_id do SoundCloud). A criação é sempre pelo assistente manual.

**A testar com credenciais reais:**
- ~~SoundCloud aceita o endereço de retorno `http://127.0.0.1:47801/callback`~~ ✅ (11/11/2026).
- ~~Login completo com retorno local no PC (serviço do PC)~~ ✅ (11/11/2026). No celular: Sprint 16.
- ~~Se o `PUT` substitui a lista de faixas~~ ✅ **substitui** (remove e reordena), 11/11/2026.
- Divergência da OpenAPI: `client_credentials` só aceita o app em HTTP Basic; a renovação só no
  corpo (ver `docs/SOUNDCLOUD_API.md`).
- ~~Faixas de outros artistas em playlist~~ ✅ aceitas (11/11/2026). `blocked`: não testado.
- `you/apps` no navegador do celular.
- Comportamento das credenciais se o Pro vencer.

### Decisões complementares (aprovadas pelo usuário em 11/11/2026)

| Tema | Decisão |
|---|---|
| Escopo | PC completo nesta sprint; celular na Sprint 16 |
| Pareamento com aparelho que já tem biblioteca de **outro** `user_id` | **Recusar** com mensagem clara, antes de salvar o par |
| Segredos no PC (`client_secret` e tokens) | **DPAPI do Windows** |
| Atualizar playlist publicada | **Espelhar o CuePoint** (mesma lista e ordem), com confirmação mostrando o que entra e o que sai |
| Visibilidade de uma playlist nova | Privada por padrão, escolhida no diálogo |

**Por que o pareamento precisa da recusa:** a mesclagem (`applyOp`, `packages/core/src/merge.ts`)
trabalha por id e trata `user_id` como um campo qualquer; nada compara o usuário da operação com o
local (`Store.receive` da extensão e do Android, `insertOps` do serviço do PC). Hoje, um aparelho com
biblioteca própria de outro usuário que pareia (o `adoptUserIfEmpty` só adota o usuário do PC quando
o aparelho está vazio) **mistura as duas bibliotecas em silêncio**, sem conflito. Com o isolamento
ligado, esse aparelho parearia e depois teria todas as operações recusadas. Os dados reais estão
limpos: as 189 operações do `helper.db` (3 origens) têm o mesmo `user_id` da identidade do serviço
do PC (conferido só leitura em 11/11/2026).

### Plano da Sprint 15

Ordem: isolamento → serviço do PC + validação com credenciais reais → extensão → docs → verificação.
A validação real vem cedo porque pode mudar o desenho (por exemplo, a semântica do `PUT`).

**Bloco 1 — Isolamento por `user_id`**
- **Core TS** (`packages/core/src/ops.ts`): `assertSameUser(op, userId)` + `ForeignUserError`
  (código `foreign_user`). **Kotlin** (`android/core/.../Model.kt`): equivalente, e `Op.validate()`
  passa a validar o formato de `user_id` (paridade com o zod).
- **Recebimento:** `Store.receive` da extensão (`packages/extension/src/data/store.ts`) e do Android
  (`Store.kt`) recusam o lote inteiro se alguma operação for de outro usuário (nada é aplicado).
  Serviço do PC: `insertOps` (`packages/helper/src/db.ts`) recusa nos três caminhos (push local,
  `POST /v1/sync/push` e resultado do pull) → HTTP 409 `foreign_user`.
- **`hello` do serviço do PC** (`helper.ts`): hoje sobrescreve o `userId` em silêncio; passa a
  recusar troca de usuário quando já há operações, como já faz com o `deviceId`.
- **Pareamento:** o pedido `POST /v1/pair` passa a levar `user_id` e `can_adopt` (aparelho vazio
  que pode adotar o usuário; no PC, só com a extensão e o serviço vazios, ver *PC ⇄ PC*). O servidor (`lan.ts`) responde 409 `foreign_user` **sem consumir o token** quando o
  usuário é outro e o aparelho não pode adotar. O cliente Android (`SyncEngine.pair`) e o PC↔PC
  (`joinPairing`) também conferem a resposta e não salvam o par. Aparelho vazio continua adotando o
  usuário do PC. Mensagem única (TS e Kotlin, `FOREIGN_USER_MESSAGE`): "Os aparelhos são de
  usuários diferentes. Para parear, apague a biblioteca do aparelho novo ou restaure nele um backup
  deste aparelho."
- **PC ⇄ PC (decidido em 11/11/2026):** cada extensão cria o próprio usuário, então dois PCs novos
  seriam recusados. Ao parear com outro PC, se a extensão **e** o serviço estão vazios, o serviço
  manda `can_adopt: true`, adota o usuário do outro PC e devolve `adoptedUserId`; a extensão adota
  junto (`Store.adoptUserIfEmpty`, como o Android). Coberto em `lan.test.ts`, `store.test.ts` e e2e.
- **Repositórios:** leituras de Research, Category, Decision e Playlist filtram pelo usuário local
  (extensão: `data/queries.ts`, `data/curation.ts`, `data/playlists.ts`; Android: `Queries.kt`,
  `Curation.kt`). Track, TrackCategory e PlaylistTrack ficam globais ou derivados do pai (Track é
  `uuidv5(urn)`, igual para todos). As escritas já carimbam o usuário da loja.
- **Backup de outro usuário** restaurado num aparelho pareado: a sync falha com `foreign_user` e a
  mensagem aparece no histórico de sync (o restore não muda).
- **Vetores:** `spec/vectors/isolation.json` (aceita o mesmo usuário, recusa outro, pareamento
  vazio × não vazio), gerado no TS e lido pelo Kotlin (`SpecVectorsTest.kt`).
- **Testes:** `packages/core/test`, `packages/extension/test/store.test.ts`,
  `packages/helper/test/lan.test.ts` (pareamento recusado, push de outro usuário → 409),
  `helper.test.ts` (`hello` com outro usuário) e Android `SyncStoreTest.kt`.

**Bloco 2 — Serviço do PC: segredos, OAuth e exportação** (novos arquivos em `packages/helper/src/`)
- `secrets.ts`: DPAPI (`ProtectedData`, escopo `CurrentUser`) via `powershell.exe -NoProfile
  -NonInteractive`, com os dados **pelo stdin** (nunca na linha de comando). O cifrado fica no
  `helper.db` (`meta`, chave `sc:secrets`). Interface `SecretBox` injetável: os testes usam uma
  falsa, e um teste real roda só em `win32`.
- `soundcloud/oauth.ts`: PKCE S256 + `state`, `https://secure.soundcloud.com/authorize` e
  `/oauth/token` (com `client_secret`). Renovação em execução única quando faltar menos de 5 min;
  `invalid_grant`/`invalid_client` → estado `reconnect`, sem repetir.
- `soundcloud/callback.ts`: `node:http` em `127.0.0.1:47801`, aberto só durante um login (timeout de
  5 min); confere o `state` e responde uma página simples "Pode fechar esta aba". Fechado no `stop()`
  do `daemon.ts`.
- `soundcloud/api.ts`: `fetch` com base `https://api.soundcloud.com` e header
  `Authorization: OAuth <token>`; 429 com recuo exponencial limitado (3 tentativas); 401 → uma
  renovação e falha clara; paginação `linked_partitioning` + `next_href`.
- `soundcloud/export.ts`: monta `{"playlist":{title, description, sharing, tracks:[{urn}]}}`.
  - Faixa sem URN: `GET /resolve?url=` se tiver URL; senão é pulada e listada.
  - Criar: `POST /playlists`.
  - Atualizar (espelho): `GET /playlists/{urn}/tracks` → diferença em memória (entra, sai, ordem) →
    confirmação → `PUT /playlists/{urn}`. 404 → oferecer criar outra.
  - Nada da API é guardado além do URN da playlist.
- **Validação das credenciais** (passo 4 do assistente): uma troca `client_credentials` ao salvar;
  erro vira mensagem simples.
- **Handlers IPC** (`h.register`): `sc:status`, `sc:configure {clientId, clientSecret}`, `sc:forget`
  (apaga credenciais e tokens), `sc:login` (devolve a URL de autorização), `sc:logout`
  (`POST /disconnect` + apagar tokens), `sc:diff` e `sc:export`. Evento `sc` ao concluir login ou
  erro. Respostas abaixo de 1 MB (limite do Native Messaging).
- **Dev com o `.env`:** `scripts/sc-dev.mjs` (fora do bundle) carrega com `process.loadEnvFile()` e
  roda contra a API real numa pasta de dados temporária: login, `GET /me`, cria uma playlist privada
  de teste, `PUT` com faixa removida e reordenada, faixa de outro artista e `blocked`, e apaga a
  playlist de teste. Os resultados vão para `docs/SOUNDCLOUD_API.md`.
- **Testes:** `packages/helper/test/soundcloud.test.ts` com `fetch` falso (PKCE, troca, renovação
  única, 429, 401, paginação, espelho/diferença, faixas sem URN) e o servidor de retorno na porta 0.

**Bloco 3 — Extensão**
- `HELPER_FORWARD` com os tipos `sc:*` e repasse do evento `sc` (`src/background/index.ts`).
- **Seção "SoundCloud" em Configurações** (`src/library/pages/Settings.tsx` + componente novo), com
  os passos 1–7 do assistente aprovado:
  - selo **"Requer Artist Pro"** e pergunta inicial (sem Pro → explica e aponta os exports locais);
  - "Criar sua chave" abre `soundcloud.com/you/apps` com nome, descrição e
    `http://127.0.0.1:47801/callback`, cada um com **Copiar**;
  - "Código do app" e "Senha do app" (mascarado), com o aviso de que ficam só no PC;
  - "Entrar com SoundCloud" abre a aba de autorização (`chrome.tabs.create`) e termina em
    "Conectado como @…";
  - **Reconectar**, **Desconectar** e "Remover credenciais";
  - sem o serviço do PC: explica que ele é necessário.
- **Playlist** (`src/library/pages/PlaylistDetail.tsx`): cartão "Exportar para o SoundCloud" com o
  selo. Sem `external_playlist_id`: escolher pública/privada e exportar. Com: "Atualizar no
  SoundCloud" → mostra o que entra e o que sai → confirma. Link para abrir no SoundCloud e lista das
  faixas puladas. `Playlists.update` (`src/data/playlists.ts`) passa a aceitar
  `external_playlist_id`, que sincroniza para o celular.
- Manifesto sem mudança: as chamadas à API saem do serviço do PC.
- Prints do `you/apps` no assistente: **não implementar** (decisão de 11/11/2026); o texto com
  **Copiar** mostrou-se suficiente no teste real.

**Bloco 4 — Documentação**
- `docs/SOUNDCLOUD_API.md`: endpoints usados, autenticação, limites, resultados dos itens *A testar*
  e checklist dos Termos (ações só pelo usuário, desconectar, apagar em 7 dias, só o URN guardado,
  nome sem a marca).
- `docs/PRIVACIDADE.md`: política de privacidade exigida pelos Termos (o que fica no aparelho e o que
  vai ao SoundCloud), utilizável como site no cadastro do app.
- `docs/MULTIUSUARIO.md`: isolamento implementado + desenho do compartilhamento por convite
  (futuro, sem código).
- `README.md`: "Exportar para o SoundCloud (requer Artist Pro)" e passo a passo do assistente.

**Verificação**
- Comandos da seção *Verificação*, mais `npm run vectors -w @cuepoint/core` (gera
  `isolation.json`).
- Serviço do PC reinstalado e extensão recarregada (ver *Como retomar*); a sync PC ⇄ celular real
  continua funcionando (mesmo `user_id`). A biblioteca real do PC nunca é apagada nem restaurada.

## Sprint 16 — SoundCloud no celular

Objetivo: exportar e atualizar playlists pelo app Android **sem o PC ligado**, cumprindo as
decisões de 11/11/2026 (*Aparelhos*):
- credenciais entregues uma vez pelo canal de pareamento, nunca pela sync;
- Keystore do Android;
- tokens próprios em cada aparelho;
- servidor local na porta 47801 só durante o login;
- mesmo `external_playlist_id`.

**Fatos levantados (12/11/2026, só leitura):**
- **O celular é só cliente.** Ele não abre porta; sync, pareamento e revogação partem dele
  (`sync/PeerClient.kt`, `sync/SyncEngine.kt`). A "entrega" é então uma requisição assinada que o
  **celular faz ao PC**, e o PC responde com as credenciais. **Não** pela resposta do `/v1/pair`,
  que sai antes da confirmação do código de 6 dígitos.
- **O canal já é confidencial:** HTTPS com o SPKI do PC fixado pelo QR. O `route()` de `lan.ts`
  confere assinatura, nonce, par `paired`, mesmo usuário e aprovação.
- **Bibliotecas no app.** Ainda não usa Keystore (a chave de assinatura fica no `meta` do Room),
  Custom Tabs nem servidor HTTP embutido. Já tem OkHttp 4.12, MockWebServer (sem uso) e
  Robolectric.
- **`external_playlist_id` no Android.** Existe no esquema (`core/Model.kt`), mas
  `data/Domain.kt` descarta o campo e `Curation.kt` não o altera.

### Decisões (aprovadas pelo usuário em 12/11/2026)

| Tema | Decisão |
|---|---|
| Entrega das credenciais | **Liberar no PC + buscar no celular:** "Enviar para <aparelho>" na extensão abre uma janela de **10 min, de uso único**; no celular, "Receber do PC". Fora da janela, ou numa segunda tentativa, o PC recusa |
| Digitar à mão no celular | **Sim**, como alternativa (sem PC, ou app criado pelo navegador do celular) |
| Tela da playlist no celular | **Paridade com o PC:** privada ou pública, prévia do que entra e sai, confirmação, Desvincular, Abrir, faixas puladas |
| Formato | Quatro sprints (16.1 a 16.4), com testes e critério de pronto; **um commit por sprint, sem push** |

### Regras que valem para todas as sprints

- **Token divergente da OpenAPI (lembrete técnico):**
  - `client_credentials` só com o app em **HTTP Basic**;
  - `authorization_code` e `refresh_token` com `client_id`/`client_secret` **no corpo**;
  - `redirect_uri` também na renovação.

  A montagem do pedido vira função pura conferida por vetor compartilhado (16.1). O Android usa
  obrigatoriamente essa função.
- **Prompt da integração:**
  - Regra 1: OpenAPI conferida antes de codar (16.1). O celular usa só endpoints já conferidos.
  - Regra 5: renovação em execução única.
  - Regra 6: `client_credentials` só ao configurar ou receber.
  - Regra 7: 429 → espera 1 s, 2 s e 4 s.
  - Regras 8 e 9: `next_href` e `access=playable,preview,blocked`.
  - Regra 10: nada embutido.
  - Regra 11: Desconectar e privacidade.
- **Verificação padrão:** `npm run lint`, `npm test`, `npm run build` e o build Android (ver
  *Verificação*), mais o que cada sprint indicar. Cada sprint só começa com autorização do usuário.

### Sprint 16.1 — Protocolo do SoundCloud compartilhado (TS ⇄ Kotlin)

- **Conferência da OpenAPI** (`api.json` atual): `POST /playlists`, `PUT /playlists/{urn}`,
  `GET /playlists/{urn}/tracks`, `GET /me`, `GET /resolve`, `POST /disconnect`, `/authorize` e
  `/oauth/token`. Se algo mudou, parar e avisar. Data registrada em `docs/SOUNDCLOUD_API.md`.
- **Novo `packages/core/src/soundcloud.ts`** (puro):
  - constantes;
  - `tokenRequest(creds, params) → {headers, body}`, extraído de `requestToken` (`oauth.ts`);
  - `authorizeUrl`;
  - `diffTracks(local, remote)`, extraído de `SoundCloud.diff` (`client.ts`).

  O serviço do PC importa daqui.
- **`spec/vectors/soundcloud.json`** (via `npm run vectors -w @cuepoint/core`): pedidos dos três
  grants, URL de autorização e casos de diferença.
- **Kotlin `android/core/.../core/SoundCloudProtocol.kt`:** espelho puro.
- **Testes:**
  - `packages/core/test/soundcloud.test.ts`: vetor + "Basic só em `client_credentials`";
  - `soundcloud.test.ts` do helper sem mudar as asserções;
  - `SoundCloudVectorsTest.kt` no `:core`.
- **Pronto quando:** OpenAPI conferida, vetor gerado, suítes TS e Kotlin passando e verificação
  padrão verde.
- Commit: `refactor: compartilha o protocolo do soundcloud entre ts e kotlin`

### Sprint 16.2 — Liberar as credenciais para um celular pareado (PC + extensão)

- **`SoundCloud`** (`client.ts`):
  - `credentials()`;
  - liberações em memória (`Map<peerId, expiresAt>`, 10 min, uso único);
  - IPC `sc:share {peerId}` (só par `paired` do mesmo usuário, com credenciais) e
    `sc:share-cancel`;
  - `sc:status` informa as liberações e `sharedAt`.
- **`Lan`** (`lan.ts`): provedor de credenciais vindo do `daemon.ts`; rota `POST /v1/sc/credentials`
  depois das checagens atuais de `route()`. Respostas:
  - 404 `sc_not_configured`;
  - 409 `sc_not_shared`;
  - 200 `{client_id, client_secret}`, que consome a liberação, grava `sc_shared_at` no peer e
    emite `sc`.
- **Extensão:**
  - `HELPER_FORWARD` ganha `sc:share` e `sc:share-cancel`.
  - Bloco "Usar no celular" em `SoundCloudSettings.tsx`: **Enviar para <nome>**, contagem, instrução
    e **Cancelar**, depois "Enviado em <data>".
  - Texto "ficam só neste PC" ajustado.
- Docs: entrega ao celular em `SOUNDCLOUD_API.md` e `PRIVACIDADE.md`.
- **Testes:**
  - `lan.test.ts` (variante de `raw` com caminho e corpo): pendente 403, sem liberação 409,
    liberado 200, segunda chamada 409, expirada 409, revogado 403, não configurado 404, outro
    usuário 409 `foreign_user`;
  - `soundcloud.test.ts`: `sc:share` recusado, `sc:share-cancel`;
  - teste do bloco na extensão e `npm run e2e`.
- **Pronto quando:** testes e verificação padrão + e2e verdes; conferido no PC (serviço reinstalado,
  extensão recarregada) que o botão aparece para o Redmi, a contagem corre e o cancelamento
  funciona.
- Commit: `feat: libera as credenciais do soundcloud para um celular pareado`

### Sprint 16.3 — Android: credenciais no Keystore e login

Novo pacote `android/app/src/main/java/com/elfo170/cuepoint/soundcloud/`.
- **`SecretBox.kt`:** `KeystoreBox` (AES-256-GCM, alias `cuepoint.sc`) e `PlainBox` (testes). Cofre
  `{clientId, clientSecret, tokens}` cifrado no `meta` (`sc.vault`), marca `sc.reconnect`, fora do
  backup.
- **`CallbackServer.kt`:** `ServerSocket` em `127.0.0.1:47801` (porta injetável), só durante o login
  (5 min).
  - Mesma página do PC, com "Voltar ao CuePoint" (`cuepoint://soundcloud`).
  - `state` errado → continua esperando; porta ocupada → mensagem clara.
- **`ScApi.kt`** (OkHttp, bases injetáveis): `requestToken` via
  `SoundCloudProtocol.tokenRequest`; `call` com 401 → uma renovação e 429 → 1/2/4 s; `GET /me` e
  `POST /disconnect`.
- **`SoundCloudService.kt`** (no `AppContainer`, `StateFlow<ScStatus>`):
  - `configure`;
  - `receiveFromPc(peerId)`, via `SyncEngine.fetchScCredentials`, que reaproveita endereços e
    assinatura;
  - `login()` (`ACTION_VIEW`), `logout()` e `forget()`;
  - renovação com `Mutex`.
- **Interface:**
  - rota `soundcloud` + botão em Configurações;
  - `ui/screens/SoundCloudScreen.kt`: selo "Requer Artist Pro"; **Receber do PC** ou **Digitar
    código e senha**; Entrar, "Conectado como @…", Reconectar, Desconectar, Remover credenciais.
- **Manifest:** host `soundcloud` no filtro `VIEW cuepoint://`.
- **Testes** (Robolectric + MockWebServer):
  - `ScApiTest`: Basic só em `client_credentials`; renovação única concorrente; `invalid_grant` →
    `reconnect` sem repetir; 401; 429;
  - `CallbackServerTest`;
  - `SoundCloudServiceTest`: cofre cifrado; `receiveFromPc` com 200, 409 e 404; `forget`; backup
    sem `sc.*`.
- **Pronto quando:** testes e verificação padrão verdes, mais o checkpoint real no Redmi:
  - Enviar/Receber do PC funciona, e a segunda tentativa é recusada;
  - o login volta para `127.0.0.1:47801` e mostra "Conectado como @…";
  - Desconectar e Reconectar funcionam.
- Commit: `feat: conecta o celular ao soundcloud com credenciais no keystore`

### Sprint 16.4 — Android: exportar e atualizar playlists sem o PC

- **Dados:** `Playlist.externalPlaylistId` (`data/Domain.kt`), `Curation.setExternalPlaylistId`
  (sincroniza) e `exportTracks(items)`.
- **`ScApi`:**
  - `resolveUrn` (302);
  - `prepare` (faixas puladas);
  - `remoteTracks` (`access=playable,preview,blocked` + `next_href`);
  - `diff` (com `diffTracks`);
  - `export`: `POST` com `sharing`, `PUT` sem, releitura para `verified`, 404 → `exists=false`.
- **Interface** (`PlaylistDetailScreen`): cartão com paridade com o `SoundCloudExport.tsx`:
  - sem configuração → tela SoundCloud;
  - Privada/Pública + Exportar;
  - Atualizar → prévia → Confirmar;
  - Desvincular, Abrir, faixas puladas, aviso de `verified=false` e Criar outra.
- **Docs finais:** `SOUNDCLOUD_API.md` (seção "No celular" e resultados), `PRIVACIDADE.md`,
  `README.md` e este planejamento.
- **Testes:**
  - `ScApiTest`: resolve, paginação, `POST`/`PUT`, verificação, 404, puladas e duplicadas;
  - `CurationTest`: `setExternalPlaylistId`;
  - teste do cartão (estados).
- **Pronto quando:** testes, verificação padrão, e2e e vetores verdes, mais o checkpoint real:
  - exportar e atualizar pelo celular com o serviço do PC parado, conferindo no SoundCloud;
  - religar o PC: o URN chega pela sync e o PC espelha a mesma playlist.
- Commit: `feat: exporta playlists para o soundcloud pelo celular`

### Riscos da Sprint 16

- **HyperOS mata o app enquanto o navegador está aberto** e o retorno do login não chega. Login
  curto; tentar de novo. Se acontecer no teste real, avaliar com o usuário um serviço em primeiro
  plano curto.
- **Porta 47801 ocupada no celular:** mensagem clara.
- **PC troca ou remove as credenciais depois da entrega:** o celular mantém as antigas até receber
  de novo.
- **PC e celular atualizam a mesma playlist juntos:** `external_playlist_id` last-write-wins; vale o
  último `PUT`.

## Issue #1 — Notificação do CuePoint reaparece após bloqueio da tela

https://github.com/elfo170/cuepoint/issues/1 (bug, prioridade sugerida: média).

**Sintoma:** a notificação reaparece sozinha alguns minutos depois de dispensada, com o CuePoint
fora dos recentes e o SoundCloud fechado. Só foi observado depois de bloquear a tela. Aparelho:
Redmi Note 14 Pro 5G, Android 15, HyperOS 2.

**Reprodução:** abrir o CuePoint → fechar o SoundCloud → dispensar a notificação → remover o
CuePoint dos recentes → bloquear a tela → aguardar alguns minutos.

**Critérios de aceite:**
- Identificar a origem da recriação da notificação.
- Impedir o reaparecimento de notificações de sessões encerradas.
- Preservar notificações legítimas de novas sessões.
- Validar o comportamento depois de bloquear e desbloquear a tela.
- Não depender de manter o app aberto nos recentes.

**Confirmado com o usuário:** a notificação que volta é a de **curadoria** (não a "Sincronizar
com…"). Decisão: depois de dispensada, ela **só volta quando o app for aberto**.

**Causa (lida no código):** `AppContainer.refreshNotification()` republicava a notificação sempre
que havia faixa, sem saber da dispensa (não havia `deleteIntent`; no Android 14+ notificação
contínua pode ser dispensada). Caminhos que a recriavam: reconexão do serviço de leitura
(`onListenerConnected`), qualquer escrita no banco (o `combine` com o `snapshot`), processo
recriado pelo sistema e a faixa velha que nunca era limpa quando a sessão do SoundCloud acabava.

**Correção:**
- `deleteIntent` → `CurationActionReceiver.ACTION_DISMISSED` → `setNotificationDismissed(true)`,
  gravado na meta `notif.dismissed` (sobrevive ao HyperOS encerrar o processo).
  `refreshNotification()` não publica enquanto estiver dispensada; `MainActivity.onStart` reativa.
- `MediaListenerService`: sem sessão ou com estado `NONE`/`STOPPED`/`ERROR` chama
  `clearMediaSessionTrack()` (só esquece faixas da sessão de mídia, não as compartilhadas).
- Logs na tag `CuePointMedia`: conexão do serviço, sessão escolhida, dispensa/reativação e
  notificação suprimida.
- Testes em `AppContainerTest`.

**Validado no celular (11/11/2026, APK debug, logcat `CuePointMedia` + eventos do sistema):**
1. Dispensada, trocar de faixa: não aparece ("notificação suprimida"); abrir o app: volta. ✅
2. Dispensada com o SoundCloud **pausado** (sessão viva), app fora dos recentes, 15 min bloqueado:
   não volta, mesmo com o WorkManager recriando o processo duas vezes. ✅
3. Sem dispensar, forçar parada do SoundCloud: a notificação some sozinha; 15 min bloqueado com o
   serviço de leitura conectado e eventos de sessão no desbloqueio: nada aparece. ✅
4. ✓/✗ na cortina continuam funcionando. ✅
5. Na tela bloqueada o sistema não deixa deslizar a notificação (Android 14+ com notificação
   contínua): a dispensa só acontece desbloqueado, e lá ela é registrada.

6. Ajuste posterior (decisão do usuário): sessão **pausada sem a notificação do player** conta como
   encerrada (o HyperOS pode manter a sessão do SoundCloud viva sem o cartão dele). Dispensar o
   cartão do SoundCloud pausado → a do CuePoint some junto. ✅ Tirar o SoundCloud dos recentes
   encerrou a sessão (estado 0) → a do CuePoint some. ✅
7. Reconexão do serviço com a notificação dispensada: **não reproduzível neste aparelho**. Desligar o
   acesso às notificações encerra o processo ("PermissionHelper") e o HyperOS recusa religar o
   serviço até o app ser aberto (o que reativa a notificação por decisão). Coberto pelo teste
   automático: a supressão fica em `refreshNotification()`, único ponto de publicação.

**Aprendizados do teste:**
- Tirar o SoundCloud dos recentes **não fecha o player** no HyperOS: o processo e a sessão de mídia
  continuam (pausada, com bloco no centro de controle). Só "Forçar parada" encerra a sessão.
- O HyperOS recusa religar o serviço de leitura de um app tirado dos recentes ("SwipeUpClean" +
  `AutoStartManagerService: Reject service`) até o app ser aberto, mesmo com início automático
  liberado. A dispensa ainda é recebida com o processo morto (o sistema o sobe para o `deleteIntent`).
- Se o app é encerrado com a notificação na tela, ela fica como está até o serviço religar.

## Notificação do Android — desenho, tentativas e análise futura

### Desenho atual (Sprints 12/13)

Notificação persistente publicada pelo próprio `NotificationListenerService`
(`MediaListenerService`), que o sistema mantém vivo: não há serviço em primeiro plano. Ações ✓, ✗ e
Categorias, em ícones vetoriais. O seletor de categorias é uma activity com `setShowWhenLocked(true)`
e **pede desbloqueio** (regra do Android). A MediaSession do SoundCloud traz título, artista e o
URN; no celular as faixas não trazem URL da página.

Saúde do serviço de leitura: `ListenerHealth` (`requestRebind`, religar o componente), reconexão ao
abrir o app e quando o serviço cai, cartão de configuração (leitura desconectada, economia de
bateria, início automático Xiaomi, permissão de notificações). O app nunca lê uma sessão de mídia
própria. O HyperOS encerra o app ao deslizá-lo nos recentes e não religa o serviço de leitura
sozinho; o início automático (op 10008) e a economia de bateria precisam estar liberados.

**Limitação aceita:** na tela bloqueada do HyperOS a notificação some quando chega outra.

### Tentativas realizadas (não repetir sem fato novo)

Objetivo de todas: manter a curadoria (✗ ✓ categorias) visível na tela bloqueada do Redmi Note 14
Pro 5G (HyperOS OS2.0.208.0.VOOMIXM, Android 15).

| # | Tentativa | Resultado |
|---|---|---|
| 1 | Ajustes na notificação comum: canal, ordem, id, som e serviço em primeiro plano | Sem efeito. A notificação some da tela bloqueada quando chega outra: o filtro está na interface do sistema. |
| 2 | Cartão de mídia próprio (sessão do CuePoint com ações personalizadas, canal `curation_v5`, ícones `ic_media_*`, cursor de categorias) | O HyperOS mostra **um cartão de mídia por vez, e o último que atualiza fica com o espaço**: quando o SoundCloud toca, ele toma o lugar do CuePoint. Desfeito. |
| 3 | Cartão espelho (o CuePoint copiaria a faixa e repassaria play/pause e comandos ao SoundCloud) | **Abortado antes de implementar** (10/11/2026), junto com a decisão de priorizar o app funcionando. Não há código nem experimento. |
| 4 | Serviço em primeiro plano dedicado (`mediaPlayback`, notificação id 1002) com layout próprio (`RemoteViews` + `DecoratedCustomViewStyle`), experimento F1 | **No-go.** Fica na tela bloqueada após o WhatsApp ✅; sobrevive à troca de faixa ❌; volta ao ligar a tela ❌; botões funcionam bloqueado ❌ (nenhum botão aparece). Código descartado sem commit. |
| 5 | Alterar o estilo de notificações do HyperOS (`status_bar_notification_style` de `1` para `0`, pelo adb, com autorização) | O layout próprio passa a ser desenhado e os ícones aparecem, mas **não funcionam como botões**. Valor original restaurado. |

**Evidências da tentativa 4 (adb, só leitura):**
- O serviço ficou em primeiro plano (`foregroundId=1002`, `types=0x2`) e a notificação continuou
  publicada (`ONGOING_EVENT|NO_CLEAR|FOREGROUND_SERVICE`, `seen=true`) depois da troca de faixa e
  ao ligar a tela: quem a esconde é a tela bloqueada, não o app.
- A interface do sistema classifica a notificação como `DCustomView`, mas mostra só título e texto,
  mesmo expandida, e não registra erro: o HyperOS **descarta o layout próprio em silêncio**.
- Descartado: o filtro "mostrar só notificações novas na tela bloqueada" está desligado
  (`lock_screen_show_only_unseen_notifications=0`).
- Não testadas: a variante `specialUse` (mesmo layout, o descarte seria o mesmo) e a variante "sem
  estilo" (igual à decorada no Android 12+ com `targetSdk` 35).

**Aprendizados que valem para qualquer nova tentativa:**
- No Android 13+, os botões do cartão de mídia vêm das **ações personalizadas do `PlaybackState`**,
  não das ações da notificação.
- A sessão de mídia precisa ser configurada numa thread com Looper (`Handler(Looper.getMainLooper())`).
- O cartão padrão comporta **4 botões** personalizados.
- Neste HyperOS, nem serviço em primeiro plano dedicado nem layout próprio mudam o critério da tela
  bloqueada. O que muda o tratamento são os mecanismos próprios do sistema (cartão de mídia,
  notificações em foco).
- Plano B citado antes de abortar, nunca feito: notificação comum com ícones e categorias mais um
  tile no painel de controle.

### Análise futura: notificações em foco (HyperOS)

**Status: adiada.** Só retomar com decisão do usuário.

O HyperOS 2 tem as **notificações em foco** (Focus Notifications, ligadas à "Hyper Island"): um
protocolo da Xiaomi para notificações contínuas exibidas de forma fixa na barra de status, na tela
bloqueada e no AOD, que é o que a curadoria precisa e que as notificações comuns não conseguem
neste aparelho.

**Indícios no aparelho (adb, só leitura):**
- `notification_focus_protocol=2` (configurações do sistema) e `updatable_focus_notifs=[]`.
- A interface do sistema tem `FocusCoordinator`, `AodFocusControllerV2` e uma lista
  `mFocusNotificationDeletedBlackList` (apps do sistema).

**Perguntas a responder na pesquisa:**
- Onde está a documentação oficial do protocolo (plataforma de desenvolvedores da Xiaomi) e como a
  notificação é marcada como "em foco" (extras e parâmetros da versão 2).
- Se apps de terceiros precisam de autorização ou de uma lista liberada pela Xiaomi, ou se basta
  seguir o protocolo.
- Se o formato aceita botões de ação (✗ ✓ e categorias) e se eles funcionam com a tela bloqueada.
- Como a notificação em foco convive com o cartão de mídia do SoundCloud e com outras notificações.

**Forma de trabalho:** pesquisa primeiro; depois um experimento go/no-go nos moldes da tentativa 4
(variante escolhida no build debug, critérios conferidos pelo usuário no celular: fica na tela
bloqueada após outra notificação, sobrevive à troca de faixa, volta ao ligar a tela, botões
funcionam bloqueado), reaproveitando `CurationActionReceiver`, o cursor de categorias e o fallback
para a notificação atual. Em no-go: registrar na tabela de tentativas, informar o usuário e
aguardar decisão.

## Checkpoints manuais pendentes (dependem do usuário)

| Sprint | Pendência |
|---|---|
| 15 | ~~Credenciais de app OAuth do SoundCloud (exigem Artist Pro)~~ ✅ criadas em 11/11/2026, no `.env` |
| 15 | ~~Login real no PC pelo assistente ("Conectado como @…")~~ ✅ 11/11/2026 (serviço do PC e extensão atualizados; 192 operações, um só usuário) |
| 15 | ~~Exportar e atualizar uma playlist de teste e conferir no SoundCloud~~ ✅ 11/11/2026 |
| 15 | ~~Rodar `npm run sc:dev`~~ ✅ 11/11/2026 (login, criar, `PUT` substitui, faixa de outro artista aceita). `blocked`: não testado (opcional) |
| 15 | ~~Prints do `you/apps` para o assistente~~ dispensados: só texto (11/11/2026) |
| 15 | Pro vencido: não testável; tratado como "credenciais inválidas" |
| 16.2 | Conferir no PC o bloco "Usar no celular" (Enviar, contagem, Cancelar) |
| 16.3 | No Redmi: Receber do PC, login com retorno em `127.0.0.1:47801`, Desconectar/Reconectar |
| 16.4 | No Redmi, com o PC parado: exportar e atualizar uma playlist de teste; depois o PC espelha a mesma |
| 16.4 | Opcional: `soundcloud.com/you/apps` no navegador do celular |

## Verificação

- **Raiz:** `npm run verify:env` · `npm run lint` · `npm test` · `npm run build` · `npm run e2e`
  (Playwright com a extensão desempacotada em perfil persistente, ~1 min).
- **Android:** `$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'; android\gradlew.bat -p android test assembleDebug`
  (inclui `:core`, que valida os `spec/vectors`).
- **Paridade TS ⇄ Kotlin:** as duas suítes rodam `spec/vectors/*.json` (`npm run vectors -w @cuepoint/core` no TS).

## Riscos

- **API do SoundCloud fechada:** a funcionalidade não é implementada e os exports locais continuam
  disponíveis.
- **Exportação depende do Artist Pro de cada usuário:** recurso para poucos, opcional, que nunca
  bloqueia a curadoria local (PRD §11.3).
- **Pro do usuário vence:** comportamento das credenciais não documentado. Tratar como "credenciais
  inválidas".
- **Termos da API mudam ou o SoundCloud revoga o acesso:** o SoundCloud pode revogar a seu critério,
  e os limites de requisição são "sujeitos a mudança".
- **Android mata o processo ou restringe segundo plano:** o listener é mantido pelo sistema, há
  WorkManager e a sync é retomada com idempotência.

## Como retomar numa sessão nova

- **Comece lendo o `prox_sessao.md`** (raiz do projeto, local e ignorado pelo Git): onde a última
  sessão parou e os próximos passos em ordem. Ao concluir um item, registre aqui e tire de lá. Se o
  arquivo não existir, siga a tabela *Próximas etapas*.
- **Atualizar o serviço do PC** depois de mudar `packages/helper` ou `packages/core`:
  `npm run build -w @cuepoint/helper`, encerrar o processo `node … cuepoint-helper.mjs daemon`
  (porta 47800 ocupada impede o novo) e rodar `npm run helper:install`. Extensão: `npm run build` e
  recarregar em `chrome://extensions`.
- **Celular real (Redmi Note 14 Pro 5G):**
  - Instalar com `adb install -r` (mantém os dados); o celular precisa estar **desbloqueado**;
    instalação nova (não atualização) pede confirmação na tela e "Instalar via USB" ligado.
  - **Regra: adb só no pacote do CuePoint e só leitura** (`run-as` para copiar o banco, `logcat`
    com as tags `CuePointSync` e `CuePointMedia`, `dumpsys`). Qualquer escrita fora disso exige
    autorização explícita. No celular, só o usuário olha a tela.
  - Depois de instalar, o usuário abre o app uma vez (o HyperOS desconecta o serviço de leitura na
    atualização).
  - O debug é outro pacote (`com.elfo170.cuepoint.debug`, nome "CuePoint (debug)") e convive com
    a release: dados, identidade e permissões próprios (liberar acesso às notificações, permissão
    de notificações, início automático e bateria no debug também). Ele começa vazio e não fica
    pareado com o PC. Os dois leem o SoundCloud, então os dois mostram notificação.
  - adb só leitura vale para os dois pacotes (`com.elfo170.cuepoint` e `.debug`).
- **Git:** um commit por etapa, Conventional Commits em pt-BR; não incluir no commit arquivos
  alterados pelo usuário (ex.: `.gitignore`, `roadmap.md`) sem combinar.
