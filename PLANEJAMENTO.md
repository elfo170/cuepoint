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
| Sprint 15 — API do SoundCloud e preparação multiusuário | Pendente. Ver *Sprint 15*. |
| Análise de notificações em foco (HyperOS) | Adiada. Ver *Notificação do Android*. |
| Publicação nas lojas (lembrete) | Mapear: extensão na Chrome Web Store e APK na Play Store. Viabilidade ainda não analisada. |

A ordem entre a issue #1 e a Sprint 15 ainda não foi decidida.

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

## Sprint 15 — P3: API do SoundCloud e preparação multiusuário

- `docs/SOUNDCLOUD_API.md`: validação das permissões da API oficial.
  - Com credenciais OAuth de app: exportar playlist interna para o SoundCloud, inclusive atualizar
    uma playlist já publicada (PKCE; troca e renovação do token pelo serviço do PC, ver *Decisões*).
  - Sem credenciais: **nenhuma operação via API** (PRD §11.2); ficam só os exports locais.
- Isolamento por `user_id` aplicado nos repositórios e na sync (operações de outro usuário são
  recusadas), com testes.
- `docs/MULTIUSUARIO.md` com o desenho do compartilhamento por convite.
- **Credenciais do autor:** criadas em 11/11/2026 (app `CuePoint` na conta Artist Pro do usuário).
  - Ficam no `.env` da raiz, ignorado pelo Git, como `SC_CLIENT_ID` e `SC_CLIENT_SECRET`.
  - **Nunca usar o prefixo `VITE_`**, que levaria o valor para a extensão compilada.
  - O `.env` serve só para desenvolvimento e testes. Na versão distribuída, cada usuário informa as
    próprias credenciais pelo assistente.
- **Pronto quando:** os testes de isolamento passam e a documentação está completa.
- Commit: `feat: valida a api do soundcloud e prepara o isolamento multiusuário`

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
   endereço de retorno, cada um com **Copiar**, e prints).
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
- Login completo com retorno local no PC (serviço do PC) e no celular (servidor local do app).
- Se o `PUT` substitui a lista de faixas.
- Faixas de outros artistas e `blocked` em playlist.
- `you/apps` no navegador do celular.
- Comportamento das credenciais se o Pro vencer.

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
