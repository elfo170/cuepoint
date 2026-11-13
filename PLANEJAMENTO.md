# CuePoint — Planejamento

Referência de produto: [CuePoint_PRD_v1.0.md](CuePoint_PRD_v1.0.md).

## Contexto

O CuePoint está distribuído (extensão Chrome, serviço do PC e app Android). As Sprints 0–16 estão
concluídas e publicadas; o histórico fica no `git log`, no código e nas notas de cada release em
`docs/releases/`. A release mais recente trouxe a exportação para o SoundCloud pelo PC e pelo
celular e o isolamento por usuário (Sprints 15 e 16). Este documento guarda só o que ainda vale para
as próximas etapas.

**Regras de trabalho:**
- Um commit por sprint/correção, em Conventional Commits e pt-BR.
- Cada etapa só começa com autorização do usuário.

**Fatos que não podem ser esquecidos:**
- A **biblioteca do PC (Chrome) tem dados reais**: nunca apagar nem restaurar por cima sem pedido
  explícito.
- O celular (Redmi Note 14 Pro 5G, HyperOS 2, Android 15) usa o APK de **release** e está pareado com
  o PC como "Celular".
- O SoundCloud está conectado no PC e no celular, cada aparelho com os próprios tokens.

## Próximas etapas

| Etapa | Situação |
|---|---|
| Exportação via Soundiiz para quem não tem Artist Pro (Issue #4) | **Planejada: Sprints 17–20.** A Sprint 17 (PoC) aguarda autorização. Ver *Nova feat: exportação via Soundiiz*. |
| Testar à mão o pareamento entre dois PCs | Pendente. Precisa de um segundo PC com o CuePoint recém-instalado (extensão e serviço vazios). Roteiro no `prox_sessao.md`. |
| Nova feat: tags no Rekordbox | **A planejar.** Ver *Nova feat: tags no Rekordbox*. |
| Notificações em foco (HyperOS) | Mapeada, sem data. Só retomar com decisão do usuário. Ver *Notificação do Android*. |

**Decidido não fazer** (não retomar): publicação nas lojas (Chrome Web Store e Play Store) e
compartilhamento de biblioteca entre pessoas por convite.

## Premissas

| Tema | Decisão |
|---|---|
| Banco no PC | IndexedDB (Dexie 4) dentro da extensão |
| Monorepo | npm workspaces (Node 22.16 / npm 10.9) |
| Toolchain web | Vite + `@crxjs/vite-plugin` 2.x, Vitest, Playwright, ESLint + Prettier |
| Serviço auxiliar | Node 22 (`node:sqlite`), Native Messaging + HTTPS na LAN + mDNS |
| Android | Kotlin + Compose + Room. AGP 8.7.3, Kotlin 2.0.21, KSP 2.0.21-1.0.28, Gradle 8.11.1, compile/target 35, minSdk 26, Compose BOM 2024.12.01, Room 2.6.1 |
| Pacote Android | `com.elfo170.cuepoint` |
| Fora do escopo | Tudo o que está no §15 do PRD: player próprio, IA, BPM/tom, atalhos, nuvem, conta obrigatória. A "integração avançada com Rekordbox" também está lá; ver a nova feat |

## Ambiente

- Android SDK: `C:/Users/Leo/AppData/Local/Android/Sdk` (android-35).
- JDK: JBR do Android Studio em `C:\Program Files\Android\Android Studio\jbr`. O `java` do sistema
  é 1.8 e não serve para o AGP, por isso o build Android roda com `JAVA_HOME` apontando para o JBR.
- Remote `origin` = github.com/elfo170/cuepoint.

## Arquitetura

### Modelo de dados

- Entidades do PRD (§6.1) com `deleted_at` (tombstone), mapa de versão por campo (HLC), `archived`
  em Researches e `position` em PlaylistTracks (chave fracionária).
- **IDs:** UUIDv7 por padrão. UUIDv5 determinístico onde dispositivos podem criar "a mesma coisa"
  de forma independente:
  - Track com URN: `uuidv5(urn)`;
  - Decision: `track_id:research_id`;
  - TrackCategory: `track:research:category`;
  - PlaylistTrack: `playlist:track`.
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
- **Isolamento por usuário:** cada instalação tem um `user_id`. Operações e pareamentos de outro
  usuário são recusados (`foreign_user`); um aparelho vazio adota o usuário de quem mostrou o código.
  Detalhes em `docs/MULTIUSUARIO.md`.

### Pareamento e segurança

- Cada dispositivo tem um par **ECDSA P-256** e um **certificado TLS autoassinado**.
- Transporte HTTPS com o certificado do servidor fixado (SPKI SHA-256).
- Toda requisição é assinada sobre `método\ncaminho\ntimestamp\nnonce\nsha256(corpo)`, com janela de
  tempo e cache de nonces contra replay. Dispositivo revogado é recusado na hora.
- **QR de uso único (5 min):** `cuepoint://pair?v=1&d=<id>&n=<nome>&a=<ip:porta,…>&f=<fp>&k=<pubkey>&t=<token>`.
  - O QR não transporta a biblioteca.
  - Os dois lados mostram um código de 6 dígitos (SAS), que o usuário confirma.
  - Em seguida o usuário define a política do par: aprovação a cada sync (padrão) ou automática.
- **Revogação:** remove a confiança no par, invalida as credenciais e avisa o par (melhor esforço).

### Protocolo de sync

- Descoberta por mDNS/DNS-SD `_cuepoint._tcp`; sem ela, últimos endereços conhecidos ou endereço
  digitado.
- O celular é só cliente: ele sempre inicia as trocas com o serviço do PC.
- Endpoints, em JSON + gzip e paginados:
  - `GET /v1/hello`, `POST /v1/pair`;
  - `POST /v1/sync/pull {vv}`, `POST /v1/sync/push {ops}`;
  - `POST /v1/revoke`;
  - `POST /v1/sc/credentials` (credenciais do SoundCloud, ver abaixo).
- Política por par: `auto` sincroniza sozinho; `ask` pede aprovação (no Android, por notificação).
  Se ninguém puder aprovar, a sync fica adiada, nunca descartada.
- Gatilhos: ao descobrir um par, após alterações locais (debounce) e periodicamente (WorkManager,
  15 min, no Android). Cada execução fica em `sync_runs`.
- Operações pendentes do mesmo registro que nenhum outro aparelho recebeu são compactadas antes do
  envio.

## SoundCloud (exportação de playlists)

Referência técnica (endpoints, divergências da OpenAPI, termos, limites e resultados com a API real):
[docs/SOUNDCLOUD_API.md](docs/SOUNDCLOUD_API.md).

> ⚠️ **A exportação para o SoundCloud só funciona para quem tem Artist Pro.** Sem nuvem (PRD §15),
> cada pessoa que usa o CuePoint registra o **próprio** app no SoundCloud, e registrar exige Artist
> Pro. Isso precisa continuar evidente na interface, no código e na documentação.

### Prompt inicial da integração (11/11/2026)

Instruções fornecidas pelo usuário para integrar a API do SoundCloud, registradas na íntegra. Valem
para qualquer mudança futura na integração:

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

### Decisões vigentes (11 e 12/11/2026)

- **Cada pessoa registra o próprio app** e informa as credenciais no CuePoint, o que exige Artist
  Pro. As alternativas foram descartadas:
  - um servidor do autor guardando o secret, por ser nuvem (PRD §15);
  - o secret embutido no build, proibido pelos termos.
- **Credenciais são do usuário:** nada de `client_id` ou `client_secret` no repositório nem no
  build.
  - Em desenvolvimento, ficam no `.env` da raiz (`SC_CLIENT_ID`, `SC_CLIENT_SECRET`), lido só por
    `npm run sc:dev`.
  - **Nunca usar o prefixo `VITE_`**, que levaria o valor para a extensão compilada.
- **Onde ficam:**
  - PC: no serviço do PC, cifradas com o DPAPI.
  - Celular: no Android Keystore.
  - Os tokens são de cada aparelho e nunca são compartilhados (o refresh token é de uso único).
- **Celular:** recebe as credenciais do PC **uma vez**, por `POST /v1/sc/credentials`.
  - Só depois da liberação feita na extensão ("Enviar para <aparelho>"), válida por 10 minutos e de
    uso único.
  - **Nunca pela sincronização.**
  - Alternativa: digitar as credenciais no celular.
- **Retorno do login:** `http://127.0.0.1:47801/callback`, o mesmo endereço nos dois aparelhos.
  - No PC, quem atende é o serviço do PC.
  - No celular, um servidor local do app, aberto só durante o login.
- **Só o URN da playlist exportada** (`external_playlist_id`) é guardado e sincronizado.
  - Atualizar **espelha** o CuePoint (mesma lista e ordem), com prévia e confirmação.
  - Playlist nova é privada por padrão.
- **Não** automatizar o site do SoundCloud para quem não tem Pro. Para essas pessoas, ficam os
  exports locais e, depois das Sprints 17–20, a exportação via Soundiiz.
  - É uma API pública e documentada, sem automação de site.
  - Quem revisa e transfere no Soundiiz é o próprio usuário.
  - Ver *Nova feat: exportação via Soundiiz*.
- **Não** usar o fluxo de pareamento do `sc-api-auth.mjs` (rotas não documentadas).
- **Paridade TS ⇄ Kotlin:** a forma dos pedidos é definida uma vez e conferida por
  `spec/vectors/soundcloud.json`:
  - TS: `packages/core/src/soundcloud.ts`;
  - Kotlin: `SoundCloudProtocol`.

## Nova feat: exportação via Soundiiz (Issue #4)

Pedido do usuário (Issue #4, `enhancement` + `poc`): exportar playlists para o SoundCloud **sem
Artist Pro**, pela API pública de importação do Soundiiz. Planejado em 13/11/2026. Nada foi
implementado ainda.

### Contrato da API

- **Fonte:** artigo
  [[API] Let your users import any tracklist to Soundiiz](https://support.soundiiz.com/hc/en-us/articles/36613501259922--API-Let-your-users-import-any-tracklist-to-Soundiiz),
  atualizado em 04/11/2026.
  - A página devolve 403 para acesso automatizado.
  - Para ler o texto, usar a API pública do Zendesk:
    `https://support.soundiiz.com/api/v2/help_center/en-us/articles/36613501259922.json`.
- **Pedido:** `POST https://soundiiz.com/go/import-playlist`, `Content-Type: application/json`.
  Não exige API key nem assinatura.
- **Campos obrigatórios:**
  - `title`;
  - `tracklist`, com 1 a 200 faixas, cada uma com `title`.
- **Campos opcionais:**
  - da playlist: `sourceName`, `sourceLogo`, `description` e `destination`;
  - da faixa: `artists` (string ou lista), `album` e `isrc`.
  - O artigo pede para omitir o que não se sabe, sem chutar.
- **Destino:** a corename do SoundCloud é `soundcloud`.
  - Quando `destination` vem preenchido, o Soundiiz pula a escolha do destino.
  - Um valor inválido dá HTTP 400 e **não** cai na escolha manual.
- **Sucesso:** `{status:"success", nbTracks, shareUrl, expiresAt}`. O link vale 24 h.
- **Erro:** HTTP 400 com `{status:"error", message}`. Exemplos de mensagem: JSON inválido, sem
  `title`, `tracklist` vazia, faixa sem título no índice N, mais de 200 faixas, destino inválido.
- **O endpoint não cria a playlist na conta.**
  - Ele gera uma página temporária em que o usuário revisa as faixas e conclui a transferência.
  - Os limites do plano do Soundiiz continuam valendo.
- **CORS:** o preflight responde 200 **sem** `Access-Control-Allow-*`.
  - A extensão precisa de `host_permissions` para `https://soundiiz.com/*`.
  - O Android (OkHttp) não sofre essa restrição.

### Decisões (13/11/2026)

- **Onde roda:** no PC (extensão) e no celular, com a mesma forma de pedido.
  - A forma é definida no core e conferida por `spec/vectors/soundiiz.json` (TS ⇄ Kotlin).
- **Sem servidor do CuePoint (PRD §15):**
  - cada aparelho chama o Soundiiz diretamente, e só quando o usuário clica;
  - na extensão, sem passar pelo serviço do PC.
- **Interface:** dois cartões **sempre visíveis** na página da playlist.
  - O cartão Artist Pro continua igual.
  - O cartão novo, "SoundCloud sem Artist Pro (via Soundiiz)", fica logo abaixo dele.
  - Os botões URLs, CSV e JSON não mudam.
- **Acima de 200 faixas:** o envio é **bloqueado com aviso**. Não há divisão em partes nem
  corte.
- **Payload:**
  - `sourceName: "CuePoint"` e `destination: "soundcloud"`;
  - `title` = nome da playlist;
  - `description` = descrição da playlist, ou "Playlist exportada do CuePoint" quando vazia;
  - cada faixa vai como `{title, artists:[artist]}`, na ordem da playlist, sem `artists` quando
    o artista está vazio.
- **Fica fora do payload:**
  - `album` e `isrc`, que o CuePoint não tem;
  - URN e link da faixa, porque a API não aceita IDs do SoundCloud;
  - `sourceLogo`, porque não há URL pública estável do logo.
- **Falsos positivos não são corrigidos no código.**
  - A interface avisa que a correspondência pode errar e que as faixas devem ser revisadas no
    Soundiiz antes da transferência.
  - Não há novas tentativas automáticas.
- **PoC:** pode usar playlists reais da biblioteca e criar playlists de teste, desde que informe
  quais são. Nada é apagado.

### Sprints

Branch `feat/soundiiz`, a partir de `main`. Um commit por sprint. **Cada sprint só começa com
autorização do usuário.**

**Sprint 17 — PoC (Fase 1 da issue).** É um portão: a Sprint 18 só começa depois que o usuário
aprovar o resultado.
- **Core** (`packages/core/src/soundiiz.ts`, só funções puras, exportado em `src/index.ts`):
  - Constantes: endpoint, `SOUNDIIZ_MAX_TRACKS = 200` e o destino `soundcloud`.
  - `soundiizImportRequest({name, description, tracks})` → `{url, headers, body}`, com a ordem
    preservada.
  - `soundiizParseResponse(status, json)` → `{ok, shareUrl, nbTracks, expiresAt}` ou um erro
    tipado (`invalid`, `too_many`, `empty`, `http`, `unavailable`).
  - Testes em `packages/core/test/soundiiz.test.ts`. Eles geram `spec/vectors/soundiiz.json`
    (`toMatchFileSnapshot`, `npm run vectors`), que ganha uma linha no `spec/README.md`.
- **Script de desenvolvimento** `packages/helper/scripts/soundiiz-poc.mjs`, no estilo do
  `sc-dev.mjs`:
  - Lê o JSON exportado pelo botão JSON da extensão (`{name, description, tracks}`).
  - Opcionalmente, lê o `helper.db` só para leitura (`node:sqlite` com `readOnly: true`).
  - Monta o pedido pelo core, faz o POST e imprime `shareUrl`, `nbTracks` e `expiresAt`.
  - `--dry-run` mostra o payload sem enviar.
- **Roteiro com o usuário:**
  - Playlists: de 3 a 5 reais, de tamanhos e gêneros variados, mais fixtures de borda (1 faixa,
    200, 201, artista vazio, caracteres especiais).
  - Playlists de teste novas, se forem necessárias, levam o prefixo `[Teste Soundiiz]` e são
    listadas no relatório.
  - O usuário abre cada link e confere:
    - título correto e SoundCloud pré-selecionado;
    - faixas encontradas certas, erradas e não encontradas;
    - transferência concluída numa conta SoundCloud **gratuita**.
  - Comparação opcional: título bruto contra a divisão "Artista - Música" do título do
    SoundCloud. Só vale se ganhar com folga, e adotar é decisão do usuário.
- **CORS:** um POST real a partir de uma página da extensão de desenvolvimento, com e sem a
  `host_permissions` (sem ela, deve falhar).
- **Registro** em `docs/SOUNDIIZ_API.md`: contrato e fonte, tabela de resultados por playlist e
  limitações (precisão, 24 h, 200 faixas e plano do Soundiiz).
- Commit: `feat: prova de conceito da exportação via soundiiz`.

**Sprint 18 — Extensão (PC).**
- **Permissão:** `https://soundiiz.com/*` em `host_permissions` (`src/manifest.json`), com o
  `test/manifest.test.ts` ajustado.
- **Serviço** `packages/extension/src/library/soundiiz.ts` (`soundiizExport(playlist, items)`):
  - usa o core;
  - faz um `fetch` direto da página da biblioteca, com timeout por `AbortController`.
- **Cartão** `SoundiizExport.tsx`, em `PlaylistDetail.tsx`, logo abaixo de `<SoundCloudExport>`:
  - Título "SoundCloud sem Artist Pro (via Soundiiz)" e selo "Gratuito".
  - Aviso curto:
    - título e artista vão para o Soundiiz;
    - a correspondência pode errar;
    - é preciso revisar antes de transferir;
    - o link vale 24 h.
  - **Abrir no Soundiiz** envia o pedido e abre o `shareUrl` com `chrome.tabs.create`. O link
    fica no cartão, com a hora em que expira.
  - Estados:
    - playlist vazia: botão desabilitado;
    - mais de 200 faixas: bloqueado, com "O Soundiiz aceita até 200 faixas por envio; esta
      playlist tem N";
    - erros legíveis: rede ou timeout; 400 com a mensagem do Soundiiz; 429 e 5xx como
      "indisponível, tente mais tarde".
- **Textos de "sem Artist Pro":** citar a opção do Soundiiz em `SoundCloudExport.tsx` (estado sem
  configuração) e em `WithoutPro` (`SoundCloudSettings.tsx`).
- **Testes:**
  - Unitário `test/soundiiz-export.test.tsx`, com `fetch` simulado. Casos: sucesso abre a aba,
    ordem preservada, erro 400, erro de rede, playlist vazia e 201 faixas.
  - e2e `e2e/soundiiz-export.spec.ts`: intercepta o Soundiiz com `context.route` e confere o
    payload e a aba aberta.
  - O e2e de CSV continua passando.
- **Docs:** seção "O que é enviado ao Soundiiz" em `docs/PRIVACIDADE.md` e trecho no README.
- **Validação real:** o usuário exporta uma playlist pelo PC e conclui a transferência.
- Commit: `feat: exporta playlists para o soundcloud via soundiiz pelo pc`.

**Sprint 19 — Celular (Android).**
- **Core Kotlin:**
  - `android/core/.../SoundiizProtocol.kt`, gêmeo do core TS;
  - `SoundiizVectorsTest.kt`, que lê `spec/vectors/soundiiz.json`.
- **Cliente** `app/.../soundiiz/SoundiizClient.kt`: POST com OkHttp, no padrão do `ScApi.kt`.
- **Cartão** `ui/screens/SoundiizExportCard.kt`, com um painel sem estado e um invólucro com
  estado, como o `SoundCloudExportCard`.
  - Fica em `PlaylistDetailScreen`, logo abaixo do cartão Artist Pro.
  - Abre o link com `openInBrowser()` (`SoundCloudScreen.kt`).
  - Tem os mesmos estados e textos do PC.
- **Configurações do SoundCloud:** citar a opção do Soundiiz.
- **Testes:**
  - `SoundiizClientTest`, com MockWebServer;
  - `SoundiizExportPanelTest` (Compose + Robolectric), que roda só no debug: o nome cai na
    exclusão `ui.*PanelTest` do release.
- **Validação real no Redmi:** APK de release instalado com `adb install -r`, com autorização.
- Commit: `feat: exporta playlists para o soundcloud via soundiiz pelo celular`.

**Sprint 20 — Fechamento e release v1.2.0.**
- Registrar a validação real neste documento.
- Notas em `docs/releases/v1.2.0.md`, no formato da 1.1.0, com o aviso sobre a correspondência e
  a revisão no Soundiiz.
- Subir a versão, abrir o PR de `feat/soundiiz` para `main` e publicar a release, tudo com
  autorização do usuário.
- Pedir ao usuário para fechar ou comentar a Issue #4.

### Riscos específicos

- **A API do Soundiiz muda ou sai do ar.** É um serviço de terceiros, sem contrato com o
  CuePoint. Os exports locais continuam disponíveis.
- **Falsos positivos:** o Soundiiz casa as faixas por título e artista, e pode escolher outra
  versão ou outra faixa.
  - No SoundCloud é comum o título vir como "Artista - Música" e o uploader ser um selo ou canal.
    Isso piora a correspondência, e a PoC mede o tamanho do problema.
- **Dados vão para um terceiro:** nome e descrição da playlist, mais título e artista das faixas.
  É só por ação do usuário e precisa estar no `docs/PRIVACIDADE.md`.
- **Limites do plano gratuito do Soundiiz:** podem mudar sem aviso, e a transferência pode exigir
  uma conta no Soundiiz.
- **Link de 24 h:** gerar de novo é só clicar outra vez. Nada é guardado.

## Nova feat: tags no Rekordbox (a planejar)

Pedido do usuário (12/11/2026): planejar uma funcionalidade de **tags no Rekordbox**. Ainda sem
escopo nem decisões. O planejamento começa tirando as dúvidas com o usuário antes de qualquer código.

**Ponto de partida:**
- O PRD §15 deixa a "integração avançada com Rekordbox" fora do escopo do MVP. Esta feat precisa
  definir um escopo próprio, provavelmente só as tags, e registrar a decisão.
- O que o CuePoint tem para virar tag: categorias (por pesquisa), pesquisas, decisões e playlists.
  As faixas são identificadas pelo SoundCloud (URN e link).

**Perguntas para o planejamento:**
- O que exatamente vira tag no Rekordbox (categorias, pesquisas, aprovadas/rejeitadas) e com qual
  recurso dele (My Tag, comentários, cor, playlists)?
- Como as faixas do CuePoint casam com as do Rekordbox: faixas do SoundCloud dentro do Rekordbox,
  arquivos locais baixados depois, ou outro jeito?
- Como os dados chegam ao Rekordbox: importação por arquivo do próprio Rekordbox, como o XML de
  coleção, ou outro meio oficial? Antes de decidir, conferir a documentação oficial da Pioneer DJ /
  AlphaTheta, sem inventar formatos.
- Em qual aparelho a feat roda (PC, pela extensão ou pelo serviço do PC) e se é exportação de mão
  única ou ida e volta.

## Notificação do Android

### Desenho atual

Notificação persistente publicada pelo próprio `NotificationListenerService`
(`MediaListenerService`), que o sistema mantém vivo: não há serviço em primeiro plano.
- **Ações:** ✓, ✗ e Categorias, em ícones vetoriais.
- **Seletor de categorias:** activity com `setShowWhenLocked(true)` que **pede desbloqueio** (regra
  do Android).
- **Dados da faixa:** a MediaSession do SoundCloud traz título, artista e o URN; no celular as
  faixas não trazem URL da página.

Saúde do serviço de leitura:
- `ListenerHealth` (`requestRebind`, religar o componente) e reconexão ao abrir o app e quando o
  serviço cai.
- Cartão de configuração: leitura desconectada, economia de bateria, início automático Xiaomi,
  permissão de notificações.
- O app nunca lê uma sessão de mídia própria.

Dispensa (Issue #1, v1.0.1): depois de dispensada, a notificação **só volta quando o app for
aberto**.
- A dispensa fica gravada na meta `notif.dismissed`.
- `refreshNotification()` é o único ponto de publicação.
- Sessão encerrada, ou pausada sem o cartão do player, faz a notificação sumir.

**Limitação aceita:** na tela bloqueada do HyperOS a notificação some quando chega outra.

**Comportamento do HyperOS (aprendido nos testes):**
- Deslizar o app nos recentes encerra o processo, e o sistema não religa o serviço de leitura
  sozinho até o app ser aberto ("SwipeUpClean"). O início automático (op 10008) e a economia de
  bateria precisam estar liberados.
- Tirar o SoundCloud dos recentes **não fecha o player**: a sessão continua pausada. Só "Forçar
  parada" a encerra.

### Tentativas realizadas (não repetir sem fato novo)

Objetivo de todas: manter a curadoria (✗ ✓ categorias) visível na tela bloqueada do Redmi Note 14
Pro 5G (HyperOS OS2.0.208.0.VOOMIXM, Android 15).

| # | Tentativa | Resultado |
|---|---|---|
| 1 | Ajustes na notificação comum: canal, ordem, id, som e serviço em primeiro plano | Sem efeito. A notificação some da tela bloqueada quando chega outra: o filtro está na interface do sistema. |
| 2 | Cartão de mídia próprio (sessão do CuePoint com ações personalizadas, canal `curation_v5`, ícones `ic_media_*`, cursor de categorias) | O HyperOS mostra **um cartão de mídia por vez, e o último que atualiza fica com o espaço**: quando o SoundCloud toca, ele toma o lugar do CuePoint. Desfeito. |
| 3 | Cartão espelho (o CuePoint copiaria a faixa e repassaria play/pause e comandos ao SoundCloud) | **Abortado antes de implementar** (10/11/2026). Não há código nem experimento. |
| 4 | Serviço em primeiro plano dedicado (`mediaPlayback`, notificação id 1002) com layout próprio (`RemoteViews` + `DecoratedCustomViewStyle`) | **No-go.** Fica na tela bloqueada após o WhatsApp ✅; sobrevive à troca de faixa ❌; volta ao ligar a tela ❌; botões funcionam bloqueado ❌ (nenhum botão aparece). O HyperOS descarta o layout próprio em silêncio. |
| 5 | Alterar o estilo de notificações do HyperOS (`status_bar_notification_style` de `1` para `0`, pelo adb, com autorização) | O layout próprio passa a ser desenhado e os ícones aparecem, mas **não funcionam como botões**. Valor original restaurado. |

**Aprendizados que valem para qualquer nova tentativa:**
- No Android 13+, os botões do cartão de mídia vêm das **ações personalizadas do `PlaybackState`**,
  não das ações da notificação.
- A sessão de mídia precisa ser configurada numa thread com Looper (`Handler(Looper.getMainLooper())`).
- O cartão padrão comporta **4 botões** personalizados.
- Neste HyperOS, nem serviço em primeiro plano dedicado nem layout próprio mudam o critério da tela
  bloqueada. O que muda o tratamento são os mecanismos próprios do sistema (cartão de mídia,
  notificações em foco).
- Plano B citado antes, nunca feito: notificação comum com ícones e categorias mais um tile no
  painel de controle.

### Mapeado: notificações em foco (HyperOS)

**Status:** sem data. Só retomar com decisão do usuário.

O HyperOS 2 tem as **notificações em foco** (Focus Notifications, ligadas à "Hyper Island"). É um
protocolo da Xiaomi para notificações contínuas exibidas de forma fixa na barra de status, na tela
bloqueada e no AOD. É o que a curadoria precisa, e as notificações comuns não conseguem isso neste
aparelho.

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

**Forma de trabalho:**
1. Pesquisa primeiro.
2. Depois, um teste aprova/reprova nos moldes da tentativa 4: variante escolhida no build debug e
   critérios conferidos pelo usuário no celular.
   - Critérios: fica na tela bloqueada após outra notificação, sobrevive à troca de faixa, volta
     ao ligar a tela, botões funcionam com a tela bloqueada.
   - Reaproveitar `CurationActionReceiver`, o cursor de categorias e o fallback para a notificação
     atual.
3. Se reprovar: registrar na tabela de tentativas, informar o usuário e aguardar decisão.

## Verificação

- **Raiz:** `npm run verify:env` · `npm run lint` · `npm test` · `npm run build` · `npm run e2e`
  (Playwright com a extensão desempacotada em perfil persistente, ~1 min).
- **Android:** `$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'; android\gradlew.bat -p android test assembleDebug`
  (inclui `:core`, que valida os `spec/vectors`).
  - Os testes de tela (Compose + Robolectric) rodam só no debug.
  - O `testReleaseUnitTest` os exclui, porque a activity de teste existe só no manifesto debug.
- **Paridade TS ⇄ Kotlin:** as duas suítes rodam `spec/vectors/*.json` (`npm run vectors -w @cuepoint/core` no TS).

## Riscos

- **Exportação depende do Artist Pro de cada usuário:** recurso para poucos, opcional, que nunca
  bloqueia a curadoria local (PRD §11.3).
- **Pro do usuário vence:** comportamento das credenciais não documentado; tratado como
  "credenciais inválidas" (Reconectar).
- **Exportação via Soundiiz depende de um serviço de terceiros:** a API pode mudar ou sair do ar,
  e a correspondência das faixas pode errar. Os exports locais continuam disponíveis. Ver
  *Nova feat: exportação via Soundiiz*.
- **Termos da API mudam ou o SoundCloud revoga o acesso:** o SoundCloud pode revogar a seu critério,
  e os limites de requisição são "sujeitos a mudança". Os exports locais continuam disponíveis.
- **Android mata o processo ou restringe segundo plano:** o listener é mantido pelo sistema, há
  WorkManager e a sync é retomada com idempotência. O login do SoundCloud no celular é curto: se o
  app for encerrado no meio, basta tentar de novo.

## Como retomar numa sessão nova

- **Comece lendo o `prox_sessao.md`** (raiz do projeto, local e ignorado pelo Git): onde a última
  sessão parou e os próximos passos.
  - Registre o progresso aqui.
  - O `prox_sessao.md` só é editado quando o usuário pedir.
  - Se o arquivo não existir, siga a tabela *Próximas etapas*.
- **Atualizar o serviço do PC** depois de mudar `packages/helper` ou `packages/core`:
  1. Copiar `%LOCALAPPDATA%\CuePoint\helper.db*` para uma pasta de cópia de segurança.
  2. `npm run build -w @cuepoint/helper`.
  3. Encerrar o processo `node … cuepoint-helper.mjs daemon` (com a porta 47800 ocupada, o novo
     não sobe).
  4. Rodar `npm run helper:install`, que mantém os dados.
- **Atualizar a extensão:** `npm run build` e recarregar em `chrome://extensions`.
- **Celular real (Redmi Note 14 Pro 5G):**
  - Instalar com `adb install -r`, que mantém os dados. A release é assinada com a chave local
    (`android/keystore.properties`, fora do Git).
  - O celular precisa estar **desbloqueado**. Instalação nova (não atualização) pede confirmação
    na tela e "Instalar via USB" ligado.
  - **Regra: adb só no pacote do CuePoint e só leitura** (`logcat` com as tags `CuePointSync` e
    `CuePointMedia`, `dumpsys`). Qualquer escrita fora disso exige autorização explícita. No
    celular, só o usuário olha a tela.
  - `run-as` funciona só no debug, porque a release não é depurável. Para conferir dados reais, ler
    o `helper.db` do PC só para leitura (`node:sqlite` com `readOnly: true`).
  - Depois de instalar, o usuário abre o app uma vez (o HyperOS desconecta o serviço de leitura na
    atualização).
  - O debug é outro pacote (`com.elfo170.cuepoint.debug`, nome "CuePoint (debug)") e convive com
    a release, com dados, identidade e permissões próprios.
    - Ele começa vazio e não fica pareado com o PC.
    - As permissões precisam ser liberadas nele também: acesso às notificações, permissão de
      notificações, início automático e bateria.
    - Os dois leem o SoundCloud, então os dois mostram notificação.
- **Git:** um commit por etapa, em Conventional Commits e pt-BR. Não incluir no commit arquivos
  alterados pelo usuário (ex.: `.gitignore`, `roadmap.md`) sem combinar.
