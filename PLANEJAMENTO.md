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
| Issue #1 — notificação reaparece após bloquear a tela | Aberta. Ver *Issue #1*. |
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
    uma playlist já publicada (`chrome.identity.launchWebAuthFlow` + PKCE, token protegido).
  - Sem credenciais: **nenhuma operação via API** (PRD §11.2); ficam só os exports locais.
- Isolamento por `user_id` aplicado nos repositórios e na sync (operações de outro usuário são
  recusadas), com testes.
- `docs/MULTIUSUARIO.md` com o desenho do compartilhamento por convite.
- **Pergunta ao usuário no início:** existem credenciais de app OAuth do SoundCloud?
- **Pronto quando:** os testes de isolamento passam e a documentação está completa.
- Commit: `feat: valida a api do soundcloud e prepara o isolamento multiusuário`

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

**Hipóteses (lidas no código, ainda não confirmadas, sem log do aparelho):**
1. **Faixa antiga nunca é limpa.** Em `MediaListenerService.attach`, quando a sessão do SoundCloud
   some, o `controller` é zerado e `publish()` retorna sem chamar `setNowPlaying(null)`; a última
   faixa fica em `_nowPlaying`. O `onListenerConnected` chama `container.refreshNotification()`, que
   republica a notificação com a faixa velha. O HyperOS derruba e reconecta o listener depois do
   bloqueio de tela (há também `ListenerHealth.requestReconnect`).
2. **Notificação de sincronização.** O worker periódico (15 min) roda `SyncScheduler.syncAll` e, com
   a política `ask`, `askApproval` posta "Sincronizar com <aparelho>?".

**Primeiro passo:** confirmar com o usuário qual notificação reaparece (curadoria ou "Sincronizar
com…") e, se preciso, coletar `adb logcat` do pacote (só leitura). Isso decide entre as hipóteses.

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
| 15 | Credenciais de app OAuth do SoundCloud, se existirem |

## Verificação

- **Raiz:** `npm run verify:env` · `npm run lint` · `npm test` · `npm run build` · `npm run e2e`
  (Playwright com a extensão desempacotada em perfil persistente, ~1 min).
- **Android:** `$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'; android\gradlew.bat -p android test assembleDebug`
  (inclui `:core`, que valida os `spec/vectors`).
- **Paridade TS ⇄ Kotlin:** as duas suítes rodam `spec/vectors/*.json` (`npm run vectors -w @cuepoint/core` no TS).

## Riscos

- **API do SoundCloud fechada:** a funcionalidade não é implementada e os exports locais continuam
  disponíveis.
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
  - APK de release e APK de debug têm assinaturas diferentes: trocar um pelo outro exige
    desinstalar, então fazer backup antes.
- **Git:** um commit por etapa, Conventional Commits em pt-BR; não incluir no commit arquivos
  alterados pelo usuário (ex.: `.gitignore`, `roadmap.md`) sem combinar.
