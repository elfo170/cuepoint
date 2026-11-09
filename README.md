# CuePoint

Ferramenta pessoal de curadoria musical sobre o SoundCloud. Enquanto a playlist toca, você
aprova (✓) ou rejeita (✗) cada faixa dentro de uma **pesquisa**, classifica as aprovadas em
**categorias** e consulta tudo numa biblioteca local. O SoundCloud continua sendo o player.

- Produto: [CuePoint_PRD_v1.0.md](CuePoint_PRD_v1.0.md)
- Planejamento e status das sprints: [PLANEJAMENTO.md](PLANEJAMENTO.md)

## Estado atual

- **MVP Chrome (P0):** completo — os 12 critérios de aceite do PRD §18 são cobertos por testes e2e.
- **App Android (P2):** curadoria pela notificação persistente (inclusive na tela bloqueada),
  biblioteca, playlists e identificação manual / por compartilhamento.
- **Sincronização (P1):** PC ⇄ celular e PC ⇄ PC pela rede local, sem servidor externo, via o
  serviço auxiliar do Windows. Falta a tela de conflitos (sprint 10).

## Instalação da extensão

```powershell
npm install
npm run build
```

1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione `packages/extension/dist`.
3. O ID da extensão é fixo: `daaemjinbpmlbffnjbbonliiglbmjjmn`.

Depois de atualizar o código, rode `npm run build` de novo, clique em ↻ na extensão e recarregue
as abas do SoundCloud.

## Uso

1. Abra uma playlist no `soundcloud.com` e dê play. O widget do CuePoint aparece no canto
   inferior direito. Ele pode ser arrastado pelo topo e recolhido pelo botão –.
2. Escolha a pesquisa ativa no seletor do widget, ou use **+ Nova pesquisa…**.
3. Para cada faixa:
   - **✓ Aprovar** grava a decisão `true` e abre o seletor de categorias. Você pode escolher
     várias categorias, criar uma nova na hora ou fechar sem classificar.
   - **✗ Rejeitar** grava `false` na hora, sem confirmação.
4. A mesma faixa pode ter decisões diferentes em pesquisas diferentes.
5. A **biblioteca** abre ao clicar em "CuePoint" no widget ou em **Abrir biblioteca** no ícone
   da extensão. Nela você:
   - vê as pesquisas com as abas Aprovadas, Rejeitadas e Pendentes de classificação, com filtro
     por categoria e busca;
   - consulta a visão global de músicas, com a decisão de cada uma em cada pesquisa;
   - gerencia as categorias globais;
   - monta playlists internas, manuais ou a partir de uma pesquisa ou categoria, e as exporta
     como lista de URLs, CSV ou JSON;
   - faz e restaura backups;
   - ajusta as configurações do aparelho.

### Celular (Android)

1. Gere e instale o APK de debug:

   ```powershell
   npm run android -- assembleDebug
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

2. Abra o CuePoint e libere o **acesso às notificações** (para ler a faixa do SoundCloud) e a
   permissão de **notificações**.
3. Dê play no app do SoundCloud: a notificação do CuePoint mostra a faixa com ✓ / ✗ (funciona com a
   tela bloqueada) e “Categorias” após aprovar.
4. Sem identificação automática: use **Compartilhar → CuePoint** no SoundCloud ou informe a faixa à mão.

### Sincronizar celular e PC

1. No PC, instale o serviço auxiliar (uma vez, sem administrador):

   ```powershell
   npm run helper:install
   ```

   Ele registra o serviço para o Chrome e o inicia no logon. Para criar a regra no Firewall do
   Windows (pede administrador), use `npm run helper:install -- -Firewall`; sem ela, o Windows
   pergunta na primeira conexão do celular — permita em **redes privadas**.
2. Recarregue a extensão e abra **Biblioteca → Dispositivos** (deve mostrar “conectado”).
3. Clique em **Adicionar dispositivo**: aparece um QR válido por 5 minutos.
4. No celular: **Configurações → Dispositivos e sincronização → Parear com PC** e escaneie o QR.
5. Confira se os dois mostram o mesmo código de 6 dígitos e clique em **Confirmar pareamento** no PC.
6. Escolha a política: **automática** ou **pedir aprovação** (o PC mostra uma notificação “Permitir”).

PC e celular precisam estar na mesma rede Wi-Fi. A sincronização acontece ao alterar algo, ao
encontrar o outro aparelho na rede e periodicamente. Para remover o serviço:
`npm run helper:uninstall` (os dados ficam em `%LOCALAPPDATA%\CuePoint`).

### Faixas provisórias

O CuePoint identifica cada faixa pelo **URN** do SoundCloud, que lê da página da faixa. Sem
internet ou sem o URN, a faixa entra como **provisória**, identificada por URL ou por título e
artista. Assim que o URN for conhecido, ela é associada à faixa definitiva. Também é possível
fazer isso manualmente em **Músicas → Identificar pela URL**.

### Backup

- **Automático:** diário por padrão e também a cada 100 alterações. Os arquivos vão para
  `Downloads/CuePoint/backups/`.
- **Arquivo:** `cuepoint-backup-AAAAMMDD-hhmmss.json`, com checksum SHA-256.
- **Restauração:** em **Backup → Restaurar de arquivo…**. O CuePoint valida o checksum, o
  schema e as referências antes de qualquer alteração, faz um backup de segurança do estado
  atual e substitui tudo numa única transação.
- Nenhum backup antigo é apagado automaticamente.

## Estrutura

| Caminho              | Conteúdo                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| `packages/core`      | Domínio em TypeScript: ids, HLC, log de operações, mesclagem, backup     |
| `packages/extension` | Extensão Chrome MV3: widget no SoundCloud, biblioteca, popup, backup     |
| `spec/`              | Contrato compartilhado TS ⇄ Kotlin: JSON Schemas e vetores de teste      |
| `android/`           | App Android (Kotlin, Compose, Room), fase P2                             |
| `scripts/`           | Verificação do ambiente e Gradle com o JBR                               |

### Detecção da faixa

A leitura da página do SoundCloud fica isolada em `packages/extension/src/content/soundcloud/`.
Quando o SoundCloud mudar o HTML, ajuste `selectors.ts` e a fixture
`test/fixtures/soundcloud-player.html`.

## Desenvolvimento

Requisitos: Node ≥ 22, npm e Google Chrome. Para o Android: Android Studio (o JBR) e o Android
SDK com a plataforma 35.

```powershell
npm run verify:env     # verifica Node, Chrome, JBR, SDK, AVD e Gradle
npm run build          # gera a extensão em packages/extension/dist
npm test               # testes unitários (Vitest), incluindo propriedades e vetores
npm run lint           # ESLint + Prettier
npm run typecheck      # TypeScript
npm run e2e            # Playwright: widget, biblioteca, playlists, backup e aceite do PRD §18
npm run android:check  # testes + assembleDebug do Android (usa o JBR)
$env:CUEPOINT_ANDROID_E2E=1; npm run test:android -w @cuepoint/helper   # e2e PC ⇄ emulador
npm run vectors -w @cuepoint/core   # regenera spec/ após mudança intencional no modelo
```

Validação opcional no SoundCloud real (precisa de internet):

```powershell
npm run e2e:soundcloud:live -w @cuepoint/extension
```
