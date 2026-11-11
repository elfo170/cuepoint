# CuePoint — Planejamento de desenvolvimento

Referência de produto: [CuePoint_PRD_v1.0.md](CuePoint_PRD_v1.0.md).

## Contexto

Hoje o repo tem só o PRD. O objetivo é implementar o produto **ponta a ponta**, em sprints:
primeiro o MVP Chrome (P0), depois a sincronização P2P na LAN (P1), o app Android (P2) e por fim
as integrações e a preparação multiusuário (P3), naquilo que a API do SoundCloud permitir.
**Cada sprint vira um commit, sem push.**

Este arquivo entra no commit da Sprint 0, e a seção *Status* é atualizada ao fim de cada sprint.
O desenvolvimento começa quando o usuário liberar.

## Premissas e decisões

| Tema | Decisão |
|---|---|
| Banco no PC | **IndexedDB (Dexie 4) dentro da extensão** — o MVP não depende de nenhum processo extra |
| Interface web local | Página da própria extensão (`library.html`): React + TypeScript + Tailwind |
| Monorepo | npm workspaces (Node 22.16 / npm 10.9; não há pnpm) |
| Toolchain web | Vite + `@crxjs/vite-plugin` 2.x (alternativa: build multi-entry do Vite), Vitest, Playwright, ESLint + Prettier |
| Serviço auxiliar (P1) | Node 22 (`node:sqlite`, sem dependências nativas), Native Messaging + HTTPS na LAN + mDNS |
| Android (P2) | Kotlin + Compose + Room. Mesmas versões já testadas com o SDK local: AGP 8.7.3, Kotlin 2.0.21, KSP 2.0.21-1.0.28, Gradle 8.11.1, compile/target 35, minSdk 26, Compose BOM 2024.12.01, Room 2.6.1 |
| Pacote Android | `com.elfo170.cuepoint` |
| Commits | Conventional Commits em pt-BR, 1 por sprint, **sem push/PR/merge** |
| Fora do escopo | Tudo o que está no §15 do PRD (player próprio, IA, BPM/tom, atalhos, nuvem, conta obrigatória) |

## Ambiente (verificado em modo leitura)

- Android SDK: `C:/Users/Leo/AppData/Local/Android/Sdk` (android-35; build-tools 34/35/36; emulator).
- JDK: JBR do Android Studio em `C:\Program Files\Android\Android Studio\jbr`. O `java` do sistema é
  1.8 e não serve para o AGP, por isso o build Android roda com `JAVA_HOME` apontando para o JBR.
- O wrapper Gradle 8.11.1 é gerado a partir da distribuição em cache (`~/.gradle/wrapper/dists`),
  sem copiar arquivos de outros projetos.
- Remote `origin` = github.com/elfo170/cuepoint — **nenhum push será feito**.

## Arquitetura

### Estrutura do repositório

```
/
├─ PLANEJAMENTO.md · README.md · CuePoint_PRD_v1.0.md
├─ package.json (workspaces) · tsconfig.base.json · eslint/prettier · .gitignore · .gitattributes
├─ spec/                  contrato compartilhado TS ⇄ Kotlin
│  ├─ schema/             JSON Schema das entidades, da operação e do protocolo
│  └─ vectors/            vetores de teste (ids, HLC, mesclagem, assinatura, backup)
├─ packages/
│  ├─ core/               TS puro: modelo, ids, HLC, log de operações, mesclagem, sessão de sync, backup
│  ├─ extension/          MV3: service worker, content script (widget), biblioteca, popup
│  └─ helper/             Node: daemon, shim de Native Messaging, servidor HTTPS na LAN, mDNS, pareamento
├─ android/               :core (Kotlin/JVM puro) + :app (Android)
└─ scripts/               verify-env.ps1, install-helper.ps1, e2e-sync-android.ps1
```

`spec/vectors` é o que garante o "modelo de dados compartilhado" do PRD: as suítes de TS (Vitest) e
de Kotlin (JUnit) carregam os **mesmos** arquivos JSON e precisam chegar ao mesmo resultado.

### Modelo de dados (preparado para sync desde o P0)

- Entidades do PRD (§6.1) com estes acréscimos: `deleted_at` (tombstone), um mapa de versão por campo
  (HLC), `archived` em Researches (PRD §7.1) e `position` em PlaylistTracks, guardado como chave
  fracionária para que inserções concorrentes não colidam.
- **IDs:** UUIDv7 por padrão. Algumas entidades usam UUIDv5 **determinístico**, para que dispositivos
  que criam "a mesma coisa" de forma independente cheguem ao mesmo registro:
  - Track com URN conhecido: `uuidv5(urn)`.
  - Decision: `uuidv5(track_id:research_id)` — uma decisão por música e pesquisa.
  - TrackCategory: `uuidv5(track:research:category)`.
  - PlaylistTrack: `uuidv5(playlist:track)`.
- **"Não avaliada"** é a ausência da Decision (ou a Decision com tombstone). Desfazer uma decisão cria
  um tombstone.
- **SyncEvents = log de operações**: `op_id`, `origin_device_id`, `seq`, `hlc`, `entity_type`,
  `entity_id`, `operation` (`put` | `delete`), campos, `base` (a versão de cada campo que o autor viu)
  e `synchronization_status`. Cada escrita grava a entidade e a operação **na mesma transação**.
  Nada é apagado automaticamente (PRD §5.7).
- **Regra de mesclagem por campo:**
  - Se `base` for igual à versão local, aplica (avanço direto).
  - Se o valor recebido for igual ao local, só atualiza a versão.
  - Se forem concorrentes e diferentes, registra um **conflito** em `conflicts` com os dois valores.
    Até o usuário resolver, vale um vencedor provisório determinístico (o de maior HLC), para que
    todas as réplicas mostrem o mesmo valor, e o conflito aparece na interface.
  - A resolução é uma nova operação que domina as duas versões.
  - Exclusão é um campo como outro qualquer, então "editar × excluir" também vira conflito.
  - Categorias diferentes, campos independentes e registros independentes se combinam sem conflito
    (PRD §5.6).
- **Entrega causal:** as réplicas trocam *vetores de versão* `{origin_device → seq}` e enviam as
  operações de todas as origens, ordenadas por HLC. Isso dá idempotência por `op_id` e retransmissão
  entre dispositivos (A→B→C).

### Extensão Chrome (P0)

- O manifesto MV3 recebe um `key` fixo para que o ID da extensão desempacotada seja estável. O
  Native Messaging exige esse ID em `allowed_origins`.
- Permissões: `storage`, `unlimitedStorage`, `alarms`, `downloads`, `notifications`,
  `nativeMessaging`, host `https://soundcloud.com/*`.
- **Adaptador SoundCloud** isolado (`src/content/soundcloud/`, interface `TrackSource`):
  - Lê o DOM da barra de reprodução (link e título da faixa, artista, capa) e observa mudanças com
    `MutationObserver`; usa `navigator.mediaSession.metadata` como fallback.
  - O URN vem da página da faixa (meta `soundcloud://sounds:ID` → `soundcloud:tracks:ID`), com cache.
    Se não for possível obtê-lo, registra uma **faixa provisória** (URL, título e artista).
  - Quando o URN aparecer, a faixa provisória é mesclada na definitiva: as decisões, categorias e
    itens de playlist são reapontados com operações normais (e geram conflito se divergirem).
- **Widget flutuante:**
  - Shadow DOM + React + Tailwind, ícones vetoriais (lucide: Check e X — sem textos nem emojis).
  - Arrastável e recolhível, posicionado para não cobrir os controles do player.
  - Mostra a faixa atual, o artista, a pesquisa ativa e o estado da decisão.
  - ✓ grava `true` e abre o seletor de categorias (múltipla escolha, criar categoria na hora,
    fechar sem classificar). ✗ grava `false` na hora, sem confirmação.
- O content script fala com o service worker por RPC tipado. O repositório (Dexie) é compartilhado
  pelo service worker e pela página da biblioteca, e o estado do HLC é atualizado dentro da mesma
  transação de escrita.

### Serviço auxiliar Windows (P1)

- **Daemon** `cuepoint-helper`, iniciado no logon pela chave `HKCU\…\Run` (sem precisar de admin).
  Dados em `%LOCALAPPDATA%\CuePoint\` (`helper.db` com `node:sqlite`, chaves, `backups\`).
- **Shim de Native Messaging** (`cuepoint-nm.cmd` → `node shim.js`, framing de 4 bytes LE). Repassa
  as mensagens ao daemon por named pipe e inicia o daemon se ele não estiver rodando. Registro em
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cuepoint.helper`, feito por
  `scripts/install-helper.ps1` (há também o de desinstalação).
- **Fonte da verdade da edição:** o IndexedDB da extensão. O daemon guarda uma **réplica do log de
  operações** (store-and-forward) e por isso continua sincronizando com os pares da LAN mesmo com o
  Chrome fechado. Quando a extensão reconecta, as duas trocam operações pelo mesmo protocolo de sessão
  do `core`, em lotes de até 1 MB.
- O PC é **um** dispositivo: o helper adota o `device_id` da extensão e guarda as chaves dele.
- Sem o helper instalado, a extensão funciona sozinha (comportamento do P0) e a biblioteca mostra o
  status "serviço auxiliar ausente".

### Pareamento e segurança (P1)

- **Chaves:** cada dispositivo tem um par **ECDSA P-256** e um **certificado TLS autoassinado**.
  P-256 tem suporte nativo em Node, WebCrypto e JCA do Android 26+, então não precisa de cripto
  exótica.
- **Transporte:** HTTPS com o **certificado do servidor fixado** (fingerprint SPKI SHA-256).
- **Autenticação do cliente:** toda requisição é **assinada** sobre
  `método\ncaminho\ntimestamp\nnonce\nsha256(corpo)`, com janela de tempo e cache de nonces contra
  replay. O servidor confere a chave do par registrado. Um dispositivo revogado é recusado na hora.
- **QR (uso único, 5 min):**
  `cuepoint://pair?v=1&d=<id>&n=<nome>&a=<ip:porta,…>&f=<fp>&k=<pubkey>&t=<token>`.
  - O QR **não transporta a biblioteca**.
  - Quem escaneia se conecta com o fingerprint fixado e envia a própria identidade.
  - Os dois lados mostram um **código de 6 dígitos** (SAS), e o usuário confirma em ambos.
  - Ao confirmar, o usuário define a política do novo par: aprovação a cada sync (padrão) ou sync
    automática.
- **PC ↔ PC:** como o PC não tem câmera, o mesmo payload pode ser colado como texto.
- **Revogação:** remove a confiança no par, invalida as credenciais dele e avisa o par (melhor
  esforço).

### Descoberta e protocolo de sync (P1)

- **Descoberta:** mDNS/DNS-SD `_cuepoint._tcp` (`bonjour-service` no PC, NsdManager no Android). Se
  a descoberta falhar, usa os últimos endereços conhecidos ou um endereço digitado manualmente.
- **Endpoints:** `GET /v1/hello`, `POST /v1/pair`, `POST /v1/sync/pull {vv}`,
  `POST /v1/sync/push {ops}`, `POST /v1/revoke`. Respostas em JSON + gzip, paginadas.
- **Política por par:**
  - `auto`: sincroniza sozinho.
  - `ask`: pede aprovação por `chrome.notifications` ou pela biblioteca (no Android, pela
    notificação). Se ninguém puder aprovar no momento, a sync fica adiada, nunca descartada.
- **Gatilhos de sync:** ao descobrir um par, após alterações locais (com debounce) e periodicamente.
  Cada execução fica registrada em `sync_runs`, que alimenta o histórico e o estado da última sync.

### Android (P2)

- **Módulos:**
  - `:core` (Kotlin/JVM puro): modelo, ids, HLC, mesclagem, protocolo e assinatura, testados contra
    `spec/vectors`.
  - `:app`: Room (espelho do schema + log de operações), Compose (pesquisas, biblioteca, categorias,
    playlists, dispositivos, conflitos, identificação manual).
- **Identificação da faixa:**
  - `NotificationListenerService` + `MediaSessionManager.getActiveSessions`, filtrando o pacote do
    SoundCloud. Usa `MEDIA_ID`/URI quando trazem o ID; senão, cria uma faixa provisória.
  - **Share target:** "Compartilhar → CuePoint" no app do SoundCloud entrega a URL da faixa e serve
    como identificação manual. Também há um formulário manual e o estado "aguardando identificação".
- **Notificação persistente:** publicada pelo próprio NotificationListenerService (que o sistema
  mantém vivo, então não precisa de serviço em primeiro plano).
  - Visível na tela bloqueada, com as ações ✓, ✗ e Categorias (ícones vetoriais).
  - O seletor de categorias é uma activity com `setShowWhenLocked(true)`.
- **Sync no Android:**
  - Servidor: NanoHTTPD 2.3.1 com TLS (certificado gerado com BouncyCastle).
  - Cliente: OkHttp 4.12 com TrustManager fixado.
  - QR: zxing-android-embedded (sem Play Services, compatível com APK manual).
  - Sync periódica: WorkManager.
- **Distribuição:** APK assinado com keystore local (`keystore.properties` fica fora do git).

### Backup

- **Formato:** `cuepoint-backup` v1 em JSON, com todas as tabelas, o log de operações, metadados e
  **SHA-256** de conteúdo canônico. O mesmo formato vale no Chrome e no Android, e há vetores de teste
  de restauração cruzada.
- **Chrome:**
  - Backup automático por `chrome.alarms` (diário e a cada N alterações), gravado em
    `Downloads/CuePoint/backups/` via `chrome.downloads`.
  - Com o helper instalado, ele grava em `%LOCALAPPDATA%\CuePoint\backups\` com escrita atômica
    (arquivo temporário + rename).
  - Backups antigos nunca são apagados.
- **Restauração:**
  - Valida o checksum, o schema e a integridade referencial antes de mexer em qualquer dado.
  - Faz um backup de segurança antes de restaurar.
  - Restaura em uma única transação (tudo ou nada).
- **Android:** backup automático numa pasta escolhida pelo usuário via SAF, ou no armazenamento
  externo do app.

## Sprints

Cada sprint termina com: build, lint e testes verdes; a seção *Status* do `PLANEJAMENTO.md`
atualizada; e **um commit** (`git add` dos caminhos da sprint + `git commit`). **Nenhum push.**

### Sprint 0 — Setup e verificação do ambiente
- Cria `PLANEJAMENTO.md`, `README.md`, `.gitignore`, `.gitattributes` e `.editorconfig`.
- Monta os workspaces (`core`, `extension`) com TS, ESLint, Prettier e Vitest.
- A extensão MV3 mínima já tem `key` fixo e carrega desempacotada.
- `scripts/verify-env.ps1` (`npm run verify:env`) verifica: Node ≥ 22, npm, Chrome, JBR 21 em
  `JAVA_HOME`, SDK com android-35, build-tools, adb, emulador/AVD e o wrapper Gradle.
- Cria `android/` (wrapper 8.11.1, `local.properties` com `sdk.dir` fora do git) com um app Compose
  vazio chamado "CuePoint" e o módulo `:core`.
- **Pronto quando:** `verify:env` passa; `npm run build`, `npm run lint` e `npm test` passam; e
  `android\gradlew.bat assembleDebug` gera o APK.
- Commit: `chore: configura monorepo, extensão mv3 e projeto android e verifica o ambiente`

### Sprint 1 — PoC: detecção da faixa no SoundCloud e widget
- Implementa o adaptador `TrackSource` (DOM + MediaSession), o resolvedor de URN e a normalização
  de `NowPlaying`.
- Widget flutuante com a faixa, o artista, a capa e os botões ✓/✗ (ainda sem persistência).
  Arrastável e recolhível.
- Testes do adaptador com fixtures HTML da barra de reprodução (jsdom).
- Smoke test com Playwright: carrega a extensão e serve `https://soundcloud.com/*` a partir da
  fixture por interceptação de rota.
- Script opcional `e2e:soundcloud:live` contra o site real (não bloqueia a sprint).
- **Pronto quando:** os testes do adaptador e o smoke test passam.
- Commit: `feat: detecta a faixa atual do soundcloud e exibe o widget flutuante`

### Sprint 2 — Núcleo de domínio e contrato compartilhado
- JSON Schemas em `spec/schema`.
- No `core`: UUIDv7 e UUIDv5, HLC, tipos de operação, motor de mesclagem por campo, conflitos,
  tombstones e regras de integridade (zod).
- Vetores em `spec/vectors` cobrindo os casos do PRD §5.6 e §7.2.
- Testes de propriedade (fast-check): o estado converge independentemente da ordem de entrega e é
  idempotente na reentrega.
- **Pronto quando:** `npm test -w core` passa, incluindo os vetores e as propriedades.
- Commit: `feat: adiciona núcleo de domínio, hlc e motor de mesclagem com contrato compartilhado`

### Sprint 3 — Persistência local e registro de decisões
- Schema Dexie com todas as tabelas, `sync_events`, `conflicts` e `meta`.
- Repositório que grava a entidade e a operação na mesma transação.
- Identidade criada na primeira execução (usuário + dispositivo com nome automático).
- RPC entre o service worker e o content script.
- Widget completo: pesquisa ativa, ✓ abre o seletor de categorias, ✗ grava na hora, estado da
  decisão visível, faixa provisória → definitiva.
- **Pronto quando:**
  - Os testes do repositório passam com `fake-indexeddb`.
  - O e2e passa: aprovar, rejeitar, a mesma faixa com decisões diferentes em pesquisas diferentes,
    várias categorias, aprovação sem categoria.
  - Os dados persistem depois de reabrir o perfil do navegador.
- Commit: `feat: persiste pesquisas, decisões e categorias no indexeddb com log de operações`

### Sprint 4 — Biblioteca web local
- `library.html` com React Router (hash).
- **Pesquisas:** listar, criar, editar e arquivar. O detalhe tem as abas Aprovadas, Rejeitadas e
  Pendentes de classificação, com filtro por categoria e busca.
- **Categorias:** CRUD completo.
- **Músicas:** visão global com as decisões por pesquisa. Permite alterar a decisão e as categorias
  e associar uma faixa provisória à definitiva colando a URL.
- Exclusões explícitas geram tombstones.
- Popup da extensão: escolher a pesquisa ativa e abrir a biblioteca.
- **Pronto quando:** os testes de componentes e o e2e de navegação e filtros passam.
- Commit: `feat: adiciona biblioteca local com pesquisas, categorias e filtros`

### Sprint 5 — Playlists internas e backup
- **Playlists:** criar manualmente ou a partir de uma pesquisa ou categoria; adicionar, remover e
  reordenar (chave fracionária); exportar como lista de URLs, CSV ou JSON.
- **Backup:**
  - Automático via alarms + downloads, e também manual.
  - Restauração validada, com backup de segurança antes e transação única.
- **Pronto quando:**
  - O ciclo backup → restauração de uma biblioteca completa preserva todas as relações (PRD §17.5).
  - Um arquivo corrompido ou adulterado é recusado.
  - Os testes de playlists passam.
- Commit: `feat: adiciona playlists internas e backup automático com restauração`

### Sprint 6 — Fechamento do MVP Chrome (P0)
- Configurações: nome do dispositivo e frequência de backup.
- Estados vazios, tratamento de erros, operação offline e acessibilidade do widget.
- Medição da latência de gravação da decisão.
- Suíte e2e com um teste por critério de aceite do PRD §18 (1–12).
- README de instalação e uso.
- **Pronto quando:** a suíte de aceite passa por completo.
- Commit: `test: cobre os critérios de aceite do mvp chrome e ajusta a usabilidade`

### Sprint 7 — Serviço auxiliar Windows e Native Messaging
- Pacote `helper`: daemon (`node:sqlite`), shim de Native Messaging via named pipe, inicialização
  automática do daemon e sessão de sync local com a extensão.
- Gera as chaves P-256 e o certificado autoassinado (`@peculiar/x509`).
- Backups gravados pelo helper.
- `install-helper.ps1` e o script de desinstalação.
- Página "Serviço auxiliar" na biblioteca.
- **Pronto quando:** passam os testes de framing, de store e de integração do shim (stdin/stdout)
  com o daemon. Depois da instalação, a extensão mostra o helper conectado.
- Commit: `feat: adiciona serviço auxiliar windows com native messaging e réplica do log`

### Sprint 8 — Pareamento por QR Code e gestão de dispositivos
- Servidor HTTPS na LAN com requisições assinadas e proteção contra replay.
- Endpoints `/v1/hello` e `/v1/pair`, token de uso único, SAS.
- Na biblioteca: QR (`qrcode`) e código em texto.
- Dispositivos: renomear, definir a política (`auto`/`ask`), revogar e ver o histórico.
- **Pronto quando:** os testes com dois helpers locais (diretórios de dados e portas diferentes)
  cobrem: pareamento ok, token expirado, token reutilizado, fingerprint errado e par revogado
  recusado.
- Commit: `feat: adiciona pareamento por qr code com chaves por dispositivo e revogação`

### Sprint 9 — Descoberta e sincronização P2P
- mDNS (anunciar e procurar) com fallback de endereço.
- `/v1/sync/pull` e `/v1/sync/push` com vetores de versão, paginação e gzip.
- Agendador de sync, aprovação para pares `ask` e `sync_runs`.
- **Compactação de operações não enviadas:** antes de cada envio, as operações pendentes do mesmo
  registro que nenhum outro aparelho recebeu viram uma só, com o estado final (ex.: incluir →
  remover → incluir uma categoria vira 1 operação; criar e excluir algo novo vira 0). Exige
  registrar quais operações já foram enviadas a cada par; as sequências são renumeradas sem
  lacunas. Os passos intermediários não são preservados (PRD §6.3: sem histórico no MVP).
- **Pronto quando:** a integração com três helpers passa nestes cenários:
  - edições offline e reconexão;
  - syncs repetidas sem duplicação;
  - sync interrompida no meio que é retomada de forma idempotente;
  - retransmissão A→B→C;
  - compactação: ciclos incluir/remover antes da sync geram o mínimo de operações e as réplicas
    continuam convergindo (teste de propriedade).
- Commit: `feat: sincroniza dispositivos pareados pela rede local com descoberta mdns`

### Sprint 10 — Conflitos, exclusões e validação do P1
- Tela de conflitos: lado a lado, escolher o valor e gerar a operação de resolução.
- Propagação de tombstones, mescla de faixas provisórias entre dispositivos e sugestão de mesclar
  categorias com o mesmo nome.
- Estado da última sync e alterações pendentes por dispositivo.
- **Pronto quando:** o teste de aceite do P1 passa — dois dispositivos pareados trocam alterações,
  inclusive após ficarem offline, sem duplicação e sem perda silenciosa (todo conflito aparece).
- Commit: `feat: resolve conflitos manualmente e propaga exclusões entre dispositivos`

### Sprint 11 — Android: base, modelo e persistência
- `:core` em Kotlin: modelo, ids, HLC e mesclagem, validados contra os **mesmos** `spec/vectors`.
- Entidades, DAOs e repositório Room com o log de operações.
- Telas Compose: pesquisas, categorias, biblioteca com filtros e playlists.
- **Pronto quando:** `gradlew testDebugUnitTest assembleDebug` passa, incluindo os vetores e os
  testes do Room com Robolectric.
- Commit: `feat: adiciona app android com room e motor de mesclagem compatível com o chrome`

### Sprint 12 — Android: MediaSession e notificação de curadoria
- NotificationListenerService + MediaSessionManager.
- Faixas provisórias, share target e formulário de identificação manual.
- Notificação persistente com ✓/✗/Categorias funcionando na tela bloqueada.
- Onboarding das permissões (acesso a notificações e `POST_NOTIFICATIONS`).
- **Pronto quando:** passam os testes de parsing de metadados e de handling das ações (Robolectric)
  e o app roda no emulador com um app de mídia de teste.
- Commit: `feat: classifica faixas do soundcloud pela notificação persistente no android`

### Sprint 13 — Android: pareamento e sincronização com o Chrome
- Protocolo e assinatura em Kotlin, validados pelos vetores de assinatura comuns.
- Servidor NanoHTTPD com TLS, cliente OkHttp com certificado fixado e NSD.
- Scanner e exibição de QR, políticas e aprovação via notificação.
- WorkManager para sync periódica; telas de dispositivos e conflitos.
- **Pronto quando:** `scripts/e2e-sync-android.ps1` passa — helper no host + app no emulador
  (via `10.0.2.2`), pareamento pelo código em texto e sync nos dois sentidos.
- Commit: `feat: pareia e sincroniza o app android com o chrome pela rede local`

### Sprint 14 — Android: backup, acabamento e APK
- Backup automático no formato comum, com teste de restauração cruzada Chrome ⇄ Android.
- Estados vazios e ajustes finais.
- `assembleRelease` assinado com keystore local; README do Android.
- **Pronto quando:** o APK de release é gerado e a restauração cruzada passa.
- Commit: `chore: adiciona backup no android e gera apk para distribuição manual`

### Sprint 15 — P3: API do SoundCloud e preparação multiusuário
- `docs/SOUNDCLOUD_API.md`: validação das permissões da API oficial.
  - Se houver credenciais OAuth: exportar playlist interna para o SoundCloud
    (`chrome.identity.launchWebAuthFlow` + PKCE, token protegido).
  - Se não houver: **nenhuma operação via API** (PRD §11.2), e ficam só os exports.
- Isolamento por `user_id` aplicado nos repositórios e na sync (operações de outro usuário são
  recusadas), com testes.
- `docs/MULTIUSUARIO.md` com o desenho do compartilhamento por convite.
- **Pronto quando:** os testes de isolamento passam e a documentação está completa.
- Commit: `feat: valida a api do soundcloud e prepara o isolamento multiusuário`

## Checkpoints manuais pendentes (dependem do usuário)

Não bloqueiam o fluxo automático. Ficam registrados como pendentes na seção *Status*.

| 15 | Credenciais de app OAuth do SoundCloud, se existirem |

## Verificação

- **Raiz:** `npm run verify:env` · `npm run lint` · `npm test` · `npm run build` · `npm run e2e`
  (Playwright com a extensão desempacotada em perfil persistente).
- **Android:** `$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'; android\gradlew.bat -p android testDebugUnitTest assembleDebug`.
- **Paridade TS ⇄ Kotlin:** as duas suítes rodam `spec/vectors/*.json`.
- **Aceite:** a suíte e2e do PRD §18 (Sprint 6), o teste de aceite do P1 (Sprint 10) e o e2e
  Chrome ⇄ Android (Sprint 13).
- **Git:** `git log --oneline` mostra um commit por sprint; `git status` fica limpo; nenhum push.

## Riscos principais

- **DOM do SoundCloud muda:** o adaptador é isolado e tem fixtures versionadas; o MediaSession serve
  de fallback.
- **URN indisponível:** a faixa fica provisória até ser associada; não há deduplicação aproximada.
- **Ciclo de vida do service worker MV3:** a porta nativa conectada mantém o worker vivo. Sem helper,
  tudo é síncrono e local.
- **mDNS no Windows e Android:** fallback para o último endereço conhecido ou endereço manual; o
  firewall precisa de uma regra. PCs com várias placas (VirtualBox, Hyper-V, VPN) são cobertos por
  uma instância de mDNS por placa; o celular prefere o endereço da mesma sub-rede.
- **Android mata o processo ou restringe segundo plano:** o listener é mantido pelo sistema, há
  WorkManager e a sync é retomada com idempotência.
- **NanoHTTPD sem manutenção:** a superfície é pequena e fica atrás de uma interface `PeerServer`,
  trocável por Ktor.
- **API do SoundCloud fechada:** a funcionalidade não é implementada e os exports locais continuam
  disponíveis.

## Próximos passos (ordem acordada em 10/11/2026)

**Objetivo:** extensão e app 100% funcionais. **Ordem:** Feature C (capas e links no celular) → Sprint 14 → Sprint 15. Cada etapa começa só com autorização do usuário e termina com um commit (sem push).

### Onde o projeto está

- P0 (MVP Chrome), P1 (sincronização na LAN, conflitos) e P2 até a Sprint 13 estão concluídos e **validados em aparelhos reais**: checkpoints das Sprints 6, 12 e 13 e validação real da Sprint 10 (ver *Status*).
- A feature de notificação na tela bloqueada foi **abortada** (seções "cartão espelho", "notificação com serviço em primeiro plano" e "notificações em foco" ficam só como histórico). A notificação de curadoria é a da Sprint 12/13.
- Uso real: a **biblioteca do PC (Chrome) tem dados reais — nunca apagar nem restaurar por cima sem pedido explícito**. O celular foi instalado limpo e adotou o usuário do PC; está pareado com o PC ("DESKTOP"), política "pedir aprovação" nos dois lados.

### Feature C — capas e links no celular

**Problema:** faixas vistas só no celular ficam sem capa e sem link. A MediaSession do SoundCloud traz título, artista e o id (URN `soundcloud:tracks:<id>`), mas não traz o endereço da página nem o da capa (`METADATA_KEY_ART_URI`/`ALBUM_ART_URI` vazios). Faixas que passam pelo Chrome já chegam com `soundcloud_url` e `artwork_url` pela sincronização (o widget lê da página).

**Não precisa da API do SoundCloud.** Abordagem:
- **Capa vinda da sessão:** a sessão tem 7 campos de metadados; a capa provavelmente vem como **imagem pronta** (`METADATA_KEY_ART`, `ALBUM_ART` ou `DISPLAY_ICON` — bitmap). **Primeiro passo: confirmar com log** em `MediaListenerService.publish` (`media/MediaListenerService.kt`) quais chaves chegam preenchidas. Se vier bitmap: reduzir (~256 px) e guardar em **cache local** do app (ex.: `filesDir/artwork/<trackId>.webp`), associado ao id da faixa. **Não sincroniza**: o campo `artwork_url` do modelo é um endereço web (validado como URL no schema), então a imagem fica só no celular.
- **Capa vinda do Chrome:** quando a faixa tiver `artwork_url` (sincronizado), usar esse endereço como reserva. O app **não tem biblioteca de imagens** — decidir na implementação entre adicionar uma (ex.: Coil) ou um carregador próprio pequeno (download + `BitmapFactory`, com cache).
- **Link "Abrir no SoundCloud":** sem API não dá para descobrir o endereço web a partir do id, e interfaces internas do SoundCloud estão fora do PRD. Mas o app do SoundCloud abre a faixa pelo **link interno `soundcloud://sounds:<id>`** (o mesmo formato que a página publica em `al:android:url` e que `SoundCloudUrls`/`MediaMetadataParser` já reconhecem). Usar `Intent(ACTION_VIEW, "soundcloud://sounds:<id>")`; se a faixa tiver `soundcloud_url`, usar o endereço web como alternativa; tratar `ActivityNotFoundException` (app do SoundCloud ausente) — se for preciso consultar antes, declarar `<queries>` para o esquema `soundcloud` no manifesto (visibilidade de pacotes do Android 11+).
- **Onde aparece:** `TrackLine` (`ui/Components.kt`, usado em Músicas e no detalhe da pesquisa) e a tela Curar (`ui/screens/CurateScreen.kt`): miniatura da capa + botão/ação "Abrir no SoundCloud".
- **Pronto quando:** testes (conversão URN → link interno, cache da capa, escolha da fonte da capa); `npm run android -- assembleDebug testDebugUnitTest` verde; no celular real, uma faixa vista só no celular mostra a capa e o botão abre o app do SoundCloud na faixa.
- **Commit sugerido:** `feat: mostra capa e abre a faixa no soundcloud a partir do celular`.
- **Implementada (10/11/2026) — falta a conferência no celular real.** Decisões: carregador próprio (download + `BitmapFactory`, sem biblioteca nova); cache `filesDir/artwork/<trackId>.webp` (o id da faixa é o UUIDv5 do URN, então serve antes mesmo de a faixa ser gravada) e `web-<sha1>.webp` para capas baixadas; sem `<queries>` no manifesto (o app tenta o link interno, depois a página web, e trata `ActivityNotFoundException`). O serviço de leitura registra as chaves da sessão uma vez por faixa: `adb logcat -s CuePointMedia`.

### Sprint 14 — Android: backup, acabamento e APK

Escopo original (seção *Sprints*), com o que já se sabe:
- **Backup automático no celular** no formato comum `cuepoint-backup` v1. A referência está em `packages/core/src/backup.ts` (`createBackup`, `validateBackup`, `parseBackup`, `backupCounts`; JSON com todas as tabelas, log de operações, metadados e **SHA-256 do conteúdo canônico**). **O Android ainda não tem nada de backup** e **não existem vetores de backup** em `spec/vectors` (hoje: `ids`, `merge`, `protocol`, `compaction`) — criar `spec/vectors/backup.json` gerado pelo TS e validado no Kotlin, para garantir a restauração cruzada.
- **Destino:** pasta escolhida pelo usuário via SAF ou armazenamento externo do app (PRD/Arquitetura → Backup). Restauração: valida checksum, schema e integridade referencial antes de mexer em dados, faz backup de segurança antes e restaura em uma única transação (tudo ou nada) — mesmas regras do Chrome.
- **Restauração cruzada:** backup do Chrome restaurado no celular e vice-versa (teste automatizado com os vetores).
- **APK de release assinado** (`assembleRelease`) com chave local: `keystore.properties` e `*.keystore` já estão no `.gitignore`; ainda não há `signingConfig` em `android/app/build.gradle.kts`.
- Estados vazios e ajustes finais; README do Android.
- **Decisões do usuário a pedir no início:** onde guardar a chave de assinatura (arquivo `.keystore` e senha, fora do git); destino padrão do backup no celular (pasta via SAF × armazenamento do app) e frequência.
- **Pronto quando:** APK de release gerado e restauração cruzada passando. Commit: `chore: adiciona backup no android e gera apk para distribuição manual`.

### Sprint 15 — P3: API do SoundCloud e preparação multiusuário

Escopo original (seção *Sprints*):
- `docs/SOUNDCLOUD_API.md` com a validação das permissões da API oficial. Com credenciais OAuth de app do SoundCloud: exportar playlist interna (`chrome.identity.launchWebAuthFlow` + PKCE, token protegido). **Sem credenciais: nenhuma operação via API** (PRD §11.2) — ficam só os exports locais.
- Isolamento por `user_id` nos repositórios e na sincronização (operações de outro usuário recusadas), com testes; `docs/MULTIUSUARIO.md` com o desenho do compartilhamento por convite.
- **Pergunta ao usuário no início:** se existem credenciais de app OAuth do SoundCloud.
- Commit: `feat: valida a api do soundcloud e prepara o isolamento multiusuário`.

### Como retomar numa sessão nova (ambiente e regras)

- **Build e testes:**
  - Raiz: `npm run lint` · `npm test` · `npm run build` · `npm run e2e` (Playwright, ~1 min).
  - Android: `$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'; android\gradlew.bat -p android test assembleDebug` (inclui `:core`, que valida os `spec/vectors`). Vetores TS: `npm run vectors -w @cuepoint/core`.
- **Atualizar o serviço do PC** depois de mudar `packages/helper` ou `packages/core`: `npm run build -w @cuepoint/helper`, encerrar o processo `node … cuepoint-helper.mjs daemon` (porta 47800 ocupada impede o novo) e rodar `npm run helper:install`. Extensão: `npm run build` e recarregar em `chrome://extensions`.
- **Celular (Redmi Note 14 Pro 5G, HyperOS 2, Android 15)**, via adb (`C:\Users\Leo\AppData\Local\Android\Sdk\platform-tools\adb.exe`):
  - instalar com `adb install -r` (mantém os dados); o celular precisa estar **desbloqueado**; instalação nova (não atualização) pede confirmação na tela e "Instalar via USB" ligado.
  - **Regra: adb só no pacote do CuePoint e só leitura** (`run-as` para copiar o banco, `logcat` com a tag `CuePointSync`, `dumpsys`). Qualquer escrita fora disso (configurações do sistema, outros apps) exige autorização explícita. No celular, só o usuário olha a tela.
  - Depois de instalar, o usuário abre o app uma vez (o HyperOS desconecta o serviço de leitura na atualização).
- **Rede:** PC no cabo (192.168.1.14) e celular na Wi-Fi (192.168.1.7); o PC tem placa do VirtualBox (192.168.56.1). Descoberta mDNS funcionando desde a correção de uma instância por placa.
- **Git:** um commit por sprint/feature, Conventional Commits em pt-BR, **sem push**; não incluir no commit arquivos alterados pelo usuário (ex.: `.gitignore`, `roadmap.md`) sem combinar.

## Status

| Sprint | Situação |
|---|---|
| 0 | Concluída — ambiente verificado (Node 22.16, Chrome, JBR 21, SDK 35, AVD Medium_Phone_API_36.0, Gradle 8.11.1) |
| 1 | Concluída — adaptador SoundCloud (DOM + MediaSession + URN), widget em Shadow DOM, e2e com fixtures. Validação no site real: `npm run e2e:soundcloud:live -w @cuepoint/extension` (opcional) |
| 2 | Concluída — ids (UUIDv7/v5), HLC, motor de mesclagem por campo, réplica de referência, 13 cenários do PRD em `spec/vectors`, JSON Schemas em `spec/schema`, testes de propriedade (convergência, idempotência, sem perda) |
| 3 | Concluída — Dexie (entidades + sync_events + conflicts + meta), repositório transacional com log de operações, identidade local, RPC service worker ⇄ widget, aprovação/rejeição/categorias persistidas, faixa provisória → definitiva |
| 4 | Concluída — biblioteca (library.html): pesquisas (criar/editar/arquivar/excluir), abas Aprovadas/Rejeitadas/Pendentes, filtro por categoria e busca, visão global de músicas por pesquisa, identificação de provisórias por URL, categorias; popup com pesquisa ativa |
| 5 | Concluída — playlists internas (manual, por pesquisa e/ou categoria; ordem por chave fracionária; exportação URLs/CSV/JSON), backup `cuepoint-backup` v1 com SHA-256, automático (alarme + a cada N alterações) em Downloads/CuePoint/backups, restauração validada e transacional com backup de segurança |
| 6 | Concluída — configurações (nome do aparelho, estado do log), acessibilidade (foco visível, aria-live), mensagens de erro do widget, suíte e2e com os 12 critérios do PRD §18 (latência medida: ~40–90 ms até gravar no IndexedDB), README de instalação e uso. **MVP Chrome (P0) concluído.** |
| 11 | Concluída — `:core` Kotlin (ids, HLC, mesclagem, réplica, chaves fracionárias) com paridade comprovada pelos mesmos `spec/vectors` do TypeScript; Room (tabela genérica com o registro JSON idêntico ao do Chrome + log + conflitos); curadoria, playlists e telas Compose (Curar com faixa manual, Pesquisas, Músicas, Categorias, Playlists, Configurações) |
| 12 | Concluída — NotificationListenerService + MediaSession (filtra o app do SoundCloud; opção "ler outros players"), URN pela MediaSession ou pela página da faixa, compartilhar → CuePoint, faixa manual, notificação persistente com ✓/✗/Categorias. Validado no emulador (Android 16): ✓/✗ funcionam com a tela bloqueada; o seletor de categorias pede desbloqueio (regra do sistema). Player de teste só no build debug |
| 7 | Concluída — pacote `helper` (Node 22, `node:sqlite`): réplica do log, identidade (ECDSA P-256 + certificado TLS autoassinado), IPC por named pipe, host de Native Messaging (inicia o serviço via WMI, fora do job do Chrome), backups em %LOCALAPPDATA%; extensão: vínculo com o serviço, sincronização local com compactação das operações não enviadas, página Dispositivos; `npm run helper:install` / `helper:uninstall`; e2e com Native Messaging real no Chromium do Playwright |
| 8 | Concluída — servidor HTTPS na LAN (certificado fixado), requisições assinadas (ECDSA P-256, janela de tempo, anti-replay), pareamento por QR/código de uso único (5 min) com código de verificação de 6 dígitos e confirmação no PC, política por aparelho (automática / pedir aprovação), revogação avisada ao par; biblioteca → Dispositivos (QR, confirmação, política, revogação, aprovação); e2e com Native Messaging real |
| 9 | Concluída — descoberta mDNS/DNS-SD (`_cuepoint._tcp`, id no TXT) com atualização de endereço dos pares, agendador (após alterações, a cada 5 min e ao descobrir um par), aprovação para pares `ask`, histórico em `sync_runs`, compactação das operações não enviadas antes do envio |
| 13 | Concluída — Android como cliente do serviço do PC: chaves ECDSA, HTTPS com certificado fixado, requisições assinadas, pareamento por QR (zxing) / código colado / link `cuepoint://pair`, código de verificação, adoção do usuário do PC quando o celular está vazio, sync pull/push em lotes com compactação das operações não enviadas, descoberta NSD, WorkManager (15 min), política por aparelho com aprovação via notificação, revogação; e2e real PC ⇄ emulador (`CUEPOINT_ANDROID_E2E=1 npm run test:android -w @cuepoint/helper`). O celular não atua como servidor (decisão desta sprint: PC ⇄ celular e PC ⇄ PC cobrem o uso; celular ⇄ celular fica para depois) |
| Ajustes Android (pós-13) | Concluídos. Mantida a **saúde do serviço de leitura**: `ListenerHealth` (`requestRebind`, religar o componente), reconexão ao abrir o app e quando o serviço cai, cartão de configuração (leitura desconectada, economia de bateria, início automático Xiaomi, permissão de notificações); o app nunca lê uma sessão de mídia própria. A parte de notificação deste ajuste (cartão de mídia com sessão própria, serviço em primeiro plano `specialUse`, canal `curation_v5`, ícones `ic_media_*`, cursor de categorias) foi **desfeita** em 10/11/2026 junto com o aborto da feature de notificação (linha abaixo) |
| Notificação na tela bloqueada (pós-13) | **Abortada** (10/11/2026). Tentativas: cartão de mídia próprio (toma o lugar do cartão do SoundCloud), feature F (no-go na F1) e estilo de notificações do HyperOS (falha); cartão espelho e notificações em foco não serão feitos. A notificação voltou à da Sprint 12/13 (✓, ✗ e Categorias, sem sessão de mídia própria): funciona na cortina; na tela bloqueada do HyperOS some quando chega outra notificação (limitação aceita). Prioridade agora: extensão e app 100% funcionais |
| 10 | Concluída — **conflitos visíveis e resolvidos pelo usuário** no Chrome (página Conflitos, com contador na navegação) e no celular (tela Conflitos, ícone com contador na barra): valores lado a lado com aparelho e horário, em texto legível (Aprovada/Rejeitada, Excluída/Mantida…), "Manter este" gera a operação de resolução. A resolução grava **só o campo escolhido** (antes também gravava `deleted_at = null`, o que ressuscitaria um item excluído e decidiria em silêncio um conflito de exclusão). Faixa provisória: decisão divergente da definitiva vira conflito (escrita concorrente, base vazia) em vez de ser descartada; provisórias são associadas automaticamente quando a definitiva chega de outro aparelho (mesma URL ou título+artista idênticos; ambíguo fica de fora). Categorias com o mesmo nome: sugestão de juntar na mais antiga (escolha determinística nos dois aparelhos). Estado por aparelho: alterações a enviar (o serviço do PC e o celular guardam o que cada par já tem) e última execução, persistidos. Vetores: 3 cenários novos (16), paridade TS ⇄ Kotlin. Aceite do P1 automatizado (`packages/helper/test/acceptance-p1.test.ts`: dois serviços pareados, edições offline, sem duplicação, conflitos iguais nos dois lados, resolução converge) |
| Feature C | Implementada — capa da MediaSession (ART / ALBUM_ART / DISPLAY_ICON) reduzida a 256 px e guardada só no celular; `artwork_url` vindo do Chrome como reserva; "Abrir no SoundCloud" (`soundcloud://sounds:<id>`, página web como alternativa) em `TrackLine` e na tela Curar; testes em `ArtworkAndLinksTest`. **Pendente:** conferir no celular real que a sessão traz a imagem (log `CuePointMedia`) e que o botão abre o app do SoundCloud na faixa |
| 14, 15 | Pendente |

**Checkpoint manual concluído (Sprint 12, 10/11/2026):** celular real (Redmi Note 14 Pro 5G, HyperOS 2) com o app do SoundCloud. A MediaSession traz título, artista e **id da faixa** (URN `soundcloud:tracks:…` em todas as faixas, sem faixas provisórias nem consulta à página). ✓ e Categorias pela notificação gravam a decisão e as categorias (inclusive criar categoria no seletor). A sessão **não** traz URL da página nem da capa: no celular as faixas ficam sem link e sem capa. Notificação na tela bloqueada: limitação aceita (feature abortada).

**Checkpoint manual concluído (Sprint 13, 10/11/2026):** serviço instalado no PC (`npm run helper:install`; o firewall já liberava o Node), app limpo no celular, pareamento pela câmera com código de verificação e política "pedir aprovação". O celular adotou o usuário do PC e recebeu a biblioteca inteira (56 operações); repetir a sync não duplica; a decisão feita no celular chegou ao Chrome (2 operações). **Descoberta mDNS:** o Android recusava em silêncio o tipo `_cuepoint._tcp.` (com ponto final) — corrigido para `_cuepoint._tcp`, e a descoberta agora registra no log (`CuePointSync`) início, falhas e serviços encontrados. Na rede do usuário (PC no cabo, celular na Wi-Fi) o roteador repassava as perguntas do celular, mas o serviço do PC não respondia: com uma única instância de mDNS, o Windows usava a placa do VirtualBox (mesma métrica de multicast que a do cabo). Corrigido: o serviço abre **uma instância de mDNS por placa IPv4** (sem loopback nem 169.254.x, sem sondagem de nome entre elas), reavalia as placas a cada 30 s e registra erros por placa sem cair; o celular usa todos os endereços anunciados (Android 14+) e põe primeiro os IPv4 da mesma sub-rede (`LanAddresses`), descartando IPv6. Validado: o celular encontra e resolve o PC em ~20 ms ao abrir o app (192.168.1.14 primeiro, 192.168.56.1 como reserva). Se o mDNS falhar em outra rede, a sync continua pelo último endereço conhecido.

**Ajustes no Android após a Sprint 13 (celular real, Redmi Note 14 Pro 5G, HyperOS):**
- O HyperOS encerra o app ao deslizá-lo nos recentes e não religa o serviço de leitura sozinho; o início automático (op 10008) e a economia de bateria precisam estar liberados. O app tenta reconectar ao ser aberto.
- Notificação comum (mesmo em primeiro plano, com ordem, som ou id ajustados) some da tela bloqueada quando chega outra: o filtro está na interface do sistema.
- Cartão de mídia: o HyperOS mostra um cartão por vez e o último que atualiza fica com o espaço, então o do SoundCloud tomou o lugar do CuePoint. Daí a decisão pelo **cartão espelho** (seção abaixo).
- O cartão padrão comporta 4 botões personalizados; o seletor de categorias completo exige desbloquear (regra do Android).
- **Decisão (10/11/2026):** a feature de notificação na tela bloqueada foi abortada para priorizar a extensão e o app funcionando por completo. As seções abaixo ficam como registro histórico.

**Nova ordem (prioridade: app no celular):** 11 → 12 (Android funcionando sozinho) → 7 → 8 → 9 → 13 (sincronização com o Chrome) → 10 → Feature C (capas e links no celular) → 14 → 15. Detalhes em "Próximos passos".

**Ajustes após a Sprint 6:** script `npm run dev` (recompilação automática); teclas digitadas no widget não acionam mais os atalhos do SoundCloud (`keyguard.js` em `document_start`); escritas sem efeito (repetir decisão, categoria, nome ou exclusão) não geram operações.

**Validação real da Sprint 10 (10/11/2026):** PC (Chrome + serviço) ⇄ celular, política "pedir aprovação" nos dois lados. A mesma categoria renomeada no Chrome e no celular antes de sincronizar virou conflito visível nos dois (contador na navegação/barra, valores lado a lado com aparelho e horário); "alterações a enviar" apareceram antes da sync e "Tudo em dia" depois; "Manter este" de um lado + nova sync fechou o conflito nos dois.

**Checkpoint manual concluído (Sprint 6, 10/11/2026):** widget validado pelo usuário no uso real em playlists do SoundCloud no Chrome (PRD §19, Fase 1), sem erros percebidos.

## Feature: cartão espelho (Android, tela bloqueada)

**Status: abortada (10/11/2026).** Nada desta seção foi implementado. Registro histórico.

### Contexto

No Redmi Note 14 Pro 5G (HyperOS, Android 15) a notificação de curadoria comum some da tela bloqueada quando chega outra notificação. Ajustes de canal, ordem, id, som e serviço em primeiro plano não resolveram, porque o filtro está na interface do sistema. Um cartão de mídia próprio (sessão `PAUSED`) aparece, mas o HyperOS mostra **um cartão de mídia por vez, e o último que atualiza fica com o espaço**: quando o SoundCloud toca, ele toma o lugar do CuePoint.

**Decisão:** o CuePoint vira o cartão de mídia visível (**cartão espelho**). Ele copia a faixa do SoundCloud, repassa play/pause e demais comandos a ele, e traz ✗ ✓ e categorias em ícones (PRD §9.3). Todo comando recebido, inclusive os botões de fone, volume longo e Bluetooth, é encaminhado ao SoundCloud, então a mudança é transparente.

**Aprendizados já validados:**
- No Android 13+ os botões do cartão vêm das **ações personalizadas da sessão** (`PlaybackState`), e não das ações da notificação.
- A sessão precisa ser configurada numa thread com Looper (`Handler(Looper.getMainLooper())`).
- O cartão padrão comporta **4 botões** personalizados.

**Regras:** `adb` só do pacote do CuePoint e em modo leitura; verificação visual no emulador; no celular, só o usuário olha a tela.

### Sprints (um commit por sprint, sem push)

| Sprint | Escopo | Pronto quando | Commit |
|---|---|---|---|
| E1 | **Experimento go/no-go.** Re-publica o cartão do CuePoint (atraso ≈400 ms) a cada evento do SoundCloud (metadados, estado, notificação). Sessão espelha PLAYING/PAUSED e repassa play/pause ao controller do SoundCloud | O usuário confirma no celular: (1) cartão do CuePoint fica visível após play no SoundCloud, (2) troca de faixa não devolve o espaço, (3) notificação do WhatsApp não o tira, (4) play/pause pelo cartão controla o SoundCloud. Se (1)–(3) falharem, **para** e volta à notificação comum + tile | `feat: tenta manter o cartão do CuePoint como player visível na tela bloqueada` |
| E2 | **Espelho completo.** Título, artista, capa, duração; posição, velocidade e ações reais; comandos play, pause, próxima, anterior e seek repassados; botões de mídia encaminhados ao SoundCloud; encerra o cartão quando a sessão do SoundCloud some | Testes de mapeamento de estado e repasse (controller falso); emulador mostra capa e barra e os comandos chegam ao player de teste | `feat: espelha a reprodução do soundcloud no cartão de mídia do cuepoint` |
| E3 | **Botões dentro do limite de 4.** Antes de aprovar: ✗ ✓ ⏯ ⏭. Depois de aprovar: ✗ ✓ etiqueta ›. Sem categorias, mantém o primeiro layout. A notificação mantém todas as ações (✗ ✓ ‹ etiqueta › + transporte) | Testes do receptor e do cursor; emulador mostra os botões certos em cada estado; usuário confere no celular | `feat: reorganiza os botões do cartão entre transporte e curadoria` |
| E4 | **Robustez e configuração.** Atraso + trava (1 publicação/s) + filtro dos eventos que o próprio CuePoint provoca; re-publica ao ligar a tela e ao desbloquear; recuperação do listener; opção "Cartão espelho" ligado/desligado nas configurações (desligado volta à notificação comum); fallback automático se a publicação falhar | Testes de atraso/trava (relógio falso) e de troca de estilo; usuário valida (tela bloqueada, WhatsApp, troca de faixa, ligar a tela) | `feat: estabiliza o cartão espelho e adiciona a opção de estilo nas configurações` |
| E5 | **Fechamento.** Testes Robolectric do que não depende do HyperOS, README (cartão espelho, opção de estilo, limitação de um cartão por vez), este documento, checklist manual no celular (play, pausa, troca, fone, volume longo, WhatsApp, bloquear/desbloquear, ✗ ✓ etiqueta ›) | `npm run android -- assembleDebug testDebugUnitTest` verde e checklist aprovado | `docs: documenta o cartão espelho e fecha a feature no android` |

### Riscos e contingência

| Risco | Contingência |
|---|---|
| O HyperOS escolhe o cartão por outro critério (por exemplo, quem começou a tocar) | A E1 detecta. Plano: notificação comum com ícones e categorias (já implementada) mais um tile no painel de controle |
| Alternância entre o cartão do SoundCloud e o do CuePoint | Atraso, trava de frequência e re-publicação ao ligar a tela (E4) |
| O SoundCloud não aceita comandos externos de transporte | O play/pause some do cartão e ficam ✗ ✓ e categorias |
| Capturar botões de mídia | Tudo é encaminhado ao SoundCloud; se algo falhar, desliga-se `FLAG_HANDLES_MEDIA_BUTTONS` |
| O usuário perde os controles do cartão do SoundCloud | Espelhados na E2 (progresso, play/pause, próxima, anterior) |

Plano detalhado: `C:\Users\Leo\.claude\plans\analise-o-prd-na-lucky-reef.md` (arquivo interno do plano, fora do repositório).

## Feature: notificação com serviço em primeiro plano e layout próprio

**Status: abortada após no-go na F1 (10/11/2026).** F2–F4 canceladas. O código do experimento (serviço dedicado, layout, seletor de variante no build debug) foi **descartado sem commit**, por decisão do usuário. Resultado em "Resultado da F1", abaixo.

### Contexto

A notificação de curadoria some da tela bloqueada do HyperOS (Redmi Note 14 Pro 5G) quando chega outra notificação. Ajustes de canal, ordem, id e som não resolveram, e o cartão de mídia próprio sofre com o limite de um cartão por vez. Esta feature testa outra hipótese: um **serviço em primeiro plano dedicado** com **notificação de layout customizado** (`RemoteViews`) é tratado de forma diferente pelo filtro do sistema. Mesmo que o filtro não mude, há ganho de conteúdo (capa, estados visuais, mais botões).

Referências (cópias locais, não versionadas; o `.gitignore` as exclui — alteração ainda não commitada):
- `foreground-services.md` (Medium, Ali Khavari Khorasani): serviço em primeiro plano, canal, manifesto, `foregroundServiceType`.
- `custom-notif-layout.md` (Medium, Adalberto Plaza): layout com `RemoteViews`, sem ConstraintLayout, estilos `Compat`, fallback com `BigPictureStyle`.

Os artigos são de antes do Android 12. Por isso o plano usa `DecoratedCustomViewStyle` e as regras atuais de serviço em primeiro plano.

### O que já existe no projeto

- **Serviço em primeiro plano:** `CurationNotification.show` chama `startForeground(1001, …, SPECIAL_USE)` dentro do `MediaListenerService`. O manifesto já declara `FOREGROUND_SERVICE_SPECIAL_USE`. Não há serviço dedicado.
- **Canal:** `curation_v5`, criado sob demanda em `ensureChannel`.
- **Layout `RemoteViews`:** não existe (`res/layout` ausente).
- **Reaproveitável:** `CurationMediaSession` (cartão de mídia) e `CurationActionReceiver` (ações ✗ ✓ e cursor de categorias).

### Abordagem

- `CurationForegroundService` é o dono da notificação de curadoria com layout próprio (id 1002, separado do 1001 do cartão padrão para que um não remova o outro). O app o inicia com `startForegroundService` e o para com `stopService`.
- `CurationRemoteViews` monta os layouts colapsado e expandido. Os botões usam `setOnClickPendingIntent` com o `PendingIntent` de `CurationNotification.action()`.
- `ArtworkLoader` decodifica a capa fora da thread principal, reduz a ~256 px e mantém cache de uma entrada.
- Layouts só com `LinearLayout`, `FrameLayout`, `ImageView` e `TextView` (sem ConstraintLayout), com `TextAppearance.Compat.Notification.*` e os ícones `ic_media_*` (sem texto nos botões). Colapsado ≤ 64 dp; expandido ≤ 256 dp.
- Estilo: `DecoratedCustomViewStyle`. A variante sem estilo entra como A/B na F1.
- Tipo do serviço: `mediaPlayback` ou `specialUse`, por constante e flag de debug.
- Fallback: falha ao montar o layout ou opção desligada → notificação atual (`MediaStyle` + `CurationMediaSession`), que continua existindo.
- Não alterar: `CurationActionReceiver`, cursor de categorias, sync.

### Sprints (um commit por sprint, sem push)

| Sprint | Escopo | Pronto quando | Commit |
|---|---|---|---|
| F1 | **Experimento go/no-go.** Serviço dedicado + layout colapsado mínimo (capa, título, artista, ✗ ✓ ‹ etiqueta ›). Variantes A/B por flag de debug. Canal criado no `CuePointApp`. | Celular: (1) notificação fica na tela bloqueada após chegar o WhatsApp, (2) sobrevive à troca de faixa, (3) volta ao ligar a tela, (4) botões funcionam bloqueado. Se (1)–(3) falharem em todas as variantes, **para**, registra o resultado aqui e aguarda decisão do usuário. | `feat: tenta manter a notificação de curadoria como serviço em primeiro plano com layout próprio` |
| F2 | **Layout completo.** Colapsado e expandido; estados (✓/✗ ativos, categoria sob o cursor, "provisória", sem pesquisa); capa; claro/escuro; fallback automático. | Emulador mostra os dois tamanhos nos estados certos (claro e escuro); testes de montagem dos `RemoteViews`. | `feat: monta o layout customizado da notificação de curadoria com capa e estados` |
| F3 | **Robustez e configuração.** Ciclo de vida (listener, `onTaskRemoved`, rebind); `ForegroundServiceStartNotAllowedException`; notificação dispensada no Android 14+ (republicar); trava de 1 publicação/s; republicar ao ligar a tela; opção "Estilo da notificação" (Layout próprio / Cartão de mídia) nas configurações. | Testes Robolectric de ciclo de vida e troca de estilo; usuário valida no celular. | `feat: estabiliza o serviço da notificação e adiciona a opção de estilo` |
| F4 | **Fechamento.** README do Android, esta seção, checklist no celular (play, pausa, troca de faixa, WhatsApp, bloquear/desbloquear, ✗ ✓ etiqueta ›, remover pelos recentes). | `npm run android -- assembleDebug testDebugUnitTest` verde e checklist aprovado. | `docs: documenta a notificação com serviço em primeiro plano e fecha a feature` |

### Riscos e contingência

| Risco | Contingência |
|---|---|
| O filtro do HyperOS independe de serviço em primeiro plano e de layout | F1 detecta. No no-go: informar o usuário e aguardar decisão. Não retomar o cartão espelho nem o tile sem nova decisão. |
| `RemoteViews` ruim em alguma ROM | Fallback para a notificação atual; opção nas configurações. |
| Serviço não pode iniciar em segundo plano (Android 12+) | `try/catch` e caminho atual no listener. |
| `mediaPlayback` sem player real | Só afeta a política da Play Store (APK é distribuição manual). Se o sistema reclamar, usar `specialUse`. |
| Bitmap grande estoura o limite do `RemoteViews` | Redução para ~256 px e cache de uma entrada. |

### Verificação

- `npm run android -- assembleDebug testDebugUnitTest` (com `JAVA_HOME` apontando para o JBR).
- Emulador (Android 16): conferir layouts e ações visualmente; `adb` somente do pacote do CuePoint, em modo leitura.
- Celular real (HyperOS): só o usuário olha a tela; critérios da F1 e checklist da F4.

### Resultado da F1 (10/11/2026) — no-go

Aparelho: Redmi Note 14 Pro 5G (24090RA29G), HyperOS OS2.0.208.0.VOOMIXM, Android 15. Variante testada: **serviço `mediaPlayback` + `DecoratedCustomViewStyle`**.

| Critério | Resultado |
|---|---|
| 1. Fica na tela bloqueada após chegar o WhatsApp | ✅ |
| 2. Sobrevive à troca de faixa | ❌ |
| 3. Volta ao ligar a tela | ❌ |
| 4. Botões funcionam bloqueado | ❌ — nenhum botão aparece |

**Evidências (adb, só leitura):**
- O serviço ficou em primeiro plano (`foregroundId=1002`, `types=0x2` = `mediaPlayback`) e a notificação continuou publicada (`ONGOING_EVENT|NO_CLEAR|FOREGROUND_SERVICE`, `seen=true`) depois da troca de faixa e ao ligar a tela. Quem a esconde é a tela bloqueada, não o app.
- A interface do sistema classifica a notificação como `DCustomView`, mas mostra só título e texto, mesmo expandida, e não registra erro: **o HyperOS descarta o layout próprio em silêncio**. Com isso, o ganho de conteúdo da feature (capa, botões) também não existe neste aparelho.
- Descartado: o filtro "mostrar só notificações novas na tela bloqueada" está desligado (`lock_screen_show_only_unseen_notifications=0`).

**Não testadas:** a variante `specialUse` usa o mesmo layout (o descarte seria o mesmo); a variante "sem estilo" é igual à decorada no Android 12+ com `targetSdk` 35 (o sistema decora layouts próprios de qualquer forma).

**Estilo de notificações do HyperOS — falha (testado com autorização do usuário):** com `status_bar_notification_style` alterado de `1` para `0` pelo adb (exige "Depuração USB (Configurações de segurança)" ligada; sem ela o HyperOS recusa a escrita), o layout próprio passa a ser desenhado na cortina e na tela bloqueada — os ícones aparecem —, mas **não funcionam como botões**. O valor original (`1`) foi restaurado logo depois.

**Aprendizado:** neste HyperOS, nem serviço em primeiro plano dedicado nem layout próprio mudam o critério da tela bloqueada. O que muda o tratamento são os mecanismos próprios do sistema (cartão de mídia, notificações em foco).

## Tentativa não realizada: notificações em foco (HyperOS)

**Status: abortada antes de começar (10/11/2026)**, junto com a feature de notificação. Fica registrada caso o tema volte.

### Contexto

O HyperOS 2 tem as **notificações em foco** (Focus Notifications, ligadas à "Hyper Island"): um protocolo da Xiaomi para notificações contínuas exibidas de forma fixa na barra de status, na tela bloqueada e no AOD — exatamente o que a curadoria precisa e que as notificações comuns, com ou sem layout próprio, não conseguem neste aparelho.

**Indícios no aparelho (adb, só leitura):**
- `notification_focus_protocol=2` (configurações do sistema) e `updatable_focus_notifs=[]`.
- A interface do sistema tem `FocusCoordinator`, `AodFocusControllerV2` e uma lista `mFocusNotificationDeletedBlackList` (apps do sistema).

### Perguntas a responder na pesquisa

- Onde está a documentação oficial do protocolo (plataforma de desenvolvedores da Xiaomi) e como a notificação é marcada como "em foco" (extras e parâmetros da versão 2 do protocolo).
- Se apps de terceiros precisam de autorização ou de uma lista liberada pela Xiaomi, ou se basta seguir o protocolo.
- Se o formato aceita botões de ação (✗ ✓ e categorias) e se eles funcionam com a tela bloqueada.
- Como a notificação em foco convive com o cartão de mídia do SoundCloud e com as outras notificações.

### Forma de trabalho

- Pesquisa primeiro; depois um experimento go/no-go nos moldes da F1 (variante escolhida no build debug, critérios 1–4 conferidos pelo usuário no celular), reaproveitando o que já existe (`CurationActionReceiver`, cursor de categorias, fallback para o cartão padrão).
- Em no-go: registrar aqui, informar o usuário e aguardar decisão.
- **Regras:** `adb` só do pacote do CuePoint e em modo leitura (qualquer escrita fora disso exige autorização explícita); no celular, só o usuário olha a tela.
