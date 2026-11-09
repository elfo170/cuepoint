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

## Checkpoints manuais (dependem do usuário)

Não bloqueiam o fluxo automático. Ficam registrados como pendentes na seção *Status*.

| Sprint | Validação |
|---|---|
| 6 | Uso real em playlists do SoundCloud no Chrome (PRD §19, Fase 1) |
| 12 | Celular real: notificação na tela bloqueada e metadados do app do SoundCloud |
| 13 | Celular real na mesma Wi-Fi: descoberta mDNS e pareamento pela câmera; regra de firewall do Windows |
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
  firewall precisa de uma regra.
- **Android mata o processo ou restringe segundo plano:** o listener é mantido pelo sistema, há
  WorkManager e a sync é retomada com idempotência.
- **NanoHTTPD sem manutenção:** a superfície é pequena e fica atrás de uma interface `PeerServer`,
  trocável por Ktor.
- **API do SoundCloud fechada:** a funcionalidade não é implementada e os exports locais continuam
  disponíveis.

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
| 10, 13–15 | Pendente |

**Checkpoint manual pendente (Sprint 12):** celular real com o app do SoundCloud — conferir se a MediaSession traz título/artista (e se traz id da faixa) e o comportamento da notificação na tela bloqueada.

**Nova ordem (prioridade: app no celular):** 11 → 12 (Android funcionando sozinho) → 7 → 8 → 9 → 13 (sincronização com o Chrome) → 10 → 14 → 15.

**Ajustes após a Sprint 6:** script `npm run dev` (recompilação automática); teclas digitadas no widget não acionam mais os atalhos do SoundCloud (`keyguard.js` em `document_start`); escritas sem efeito (repetir decisão, categoria, nome ou exclusão) não geram operações.

**Checkpoint manual pendente (Sprint 6):** validar o widget em playlists reais do SoundCloud no Chrome (PRD §19, Fase 1). Apoio: `npm run e2e:soundcloud:live -w @cuepoint/extension`.
