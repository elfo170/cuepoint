# CuePoint

**Curadoria de músicas enquanto você ouve o SoundCloud.**

Você abre uma playlist no SoundCloud e, a cada faixa, toca em **✓ aprovar** ou **✗ rejeitar**. As
aprovadas ganham **categorias** ("Vocal", "Para abrir o set"…), e tudo fica guardado numa
biblioteca pessoal, separado por **pesquisa** (ex.: "Latin Bass — março"). Com a biblioteca você
filtra o que aprovou, monta playlists e exporta.

- Funciona no **Chrome** (computador) e no **Android** (celular), com sincronização pela rede de
  casa.
- **Sem conta e sem servidor:** os dados ficam no seu computador e no seu celular.
- O SoundCloud continua sendo o player. O CuePoint só observa o que está tocando.

**[⬇ Baixar a versão mais recente](https://github.com/elfo170/cuepoint/releases/latest)**

---

## Sumário

1. [O que baixar](#1-o-que-baixar)
2. [Instalar a extensão do Chrome](#2-instalar-a-extensão-do-chrome)
3. [Usar no Chrome](#3-usar-no-chrome)
4. [Instalar o app no celular (Android)](#4-instalar-o-app-no-celular-android)
5. [Usar no celular](#5-usar-no-celular)
6. [Sincronizar celular e PC](#6-sincronizar-celular-e-pc)
7. [Backup](#7-backup)
8. [Problemas comuns](#8-problemas-comuns)
9. [Roadmap](#9-roadmap)
10. [Para desenvolvedores](#10-para-desenvolvedores)

---

## 1. O que baixar

Na [página de releases](https://github.com/elfo170/cuepoint/releases/latest), em **Assets**:

| Arquivo                         | Precisa?                                    | Requisitos                    |
| ------------------------------- | ------------------------------------------- | ----------------------------- |
| `cuepoint-extensao-1.0.0.zip`   | Sim, para usar no computador                | Google Chrome 116 ou mais novo |
| `cuepoint-1.0.0.apk`            | Se quiser usar no celular                   | Android 8.0 ou mais novo       |
| `cuepoint-servico-pc-1.0.0.zip` | Só para sincronizar o celular com o PC      | Windows 10/11 e Node.js 22.13+ |

Cada parte funciona sozinha: dá para usar só a extensão, só o celular ou os dois juntos.

## 2. Instalar a extensão do Chrome

A extensão não está na Chrome Web Store. Ela é instalada a partir da pasta baixada:

1. Baixe `cuepoint-extensao-1.0.0.zip` e **extraia** (botão direito → *Extrair tudo…*) num lugar
   fixo, por exemplo `Documentos\CuePoint`. Vai aparecer a pasta `CuePoint-extensao`.
   **Não apague essa pasta:** o Chrome carrega a extensão a partir dela.
2. No Chrome, abra o endereço `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor**, no canto superior direito.
4. Clique em **Carregar sem compactação** e escolha a pasta `CuePoint-extensao`, a que contém o
   arquivo `manifest.json`.
5. O CuePoint aparece na lista. Fixe o ícone na barra do Chrome (ícone de quebra-cabeça → alfinete)
   para achar mais fácil.

> O Chrome pode avisar sobre "extensões no modo do desenvolvedor" ao abrir. É normal para
> extensões instaladas fora da loja; escolha mantê-la.

**Atualizar para uma versão nova:** extraia o zip novo **por cima da mesma pasta**, depois clique
em ↻ no cartão do CuePoint em `chrome://extensions` e recarregue as abas do SoundCloud. Os dados
são mantidos.

## 3. Usar no Chrome

1. Abra uma playlist em [soundcloud.com](https://soundcloud.com) e dê play.
2. O **widget do CuePoint** aparece no canto inferior direito, com a faixa atual. Dá para arrastá-lo
   pelo topo e recolher pelo botão **–**.
3. Escolha a **pesquisa ativa** no seletor do widget, ou crie uma em **+ Nova pesquisa…**.
4. Para cada faixa:
   - **✓ Aprovar** grava a aprovação e abre as **categorias**. Marque quantas quiser, crie uma nova
     na hora ou feche sem classificar.
   - **✗ Rejeitar** grava na hora.
   - Tocar de novo no botão marcado desfaz a decisão.
5. A mesma faixa pode ser aprovada numa pesquisa e rejeitada em outra.

### A biblioteca

Abra pelo ícone do CuePoint na barra do Chrome (**Abrir biblioteca**) ou clicando em "CuePoint"
no widget. Nela você:

- vê cada pesquisa com as abas **Aprovadas**, **Rejeitadas** e **Pendentes de classificação**, com
  busca e filtro por categoria;
- vê **todas as músicas**, com a decisão de cada uma em cada pesquisa, e pode mudar decisões e
  categorias;
- gerencia as **categorias**;
- monta **playlists**: à mão ou a partir de uma pesquisa ou categoria. Dá para reordenar e exportar
  como lista de links, CSV ou JSON;
- faz e restaura **backups** (seção 7);
- pareia o celular em **Dispositivos** (seção 6).

**Faixa "provisória":** às vezes o CuePoint não consegue o identificador da faixa (ex.: sem
internet). Ela entra como provisória e é associada sozinha à definitiva assim que o identificador
aparecer. Também dá para associar à mão em **Músicas → Identificar pela URL**.

## 4. Instalar o app no celular (Android)

1. No celular, abra a [página de releases](https://github.com/elfo170/cuepoint/releases/latest) e
   baixe `cuepoint-1.0.0.apk`. Também dá para copiar o arquivo do computador para o celular.
2. Toque no arquivo baixado. O Android pede para **permitir a instalação de apps desconhecidos**
   pelo navegador ou gerenciador de arquivos: permita e volte.
3. Se o Play Protect avisar que o app não foi verificado, toque em **Mais detalhes → Instalar mesmo
   assim**. O app não está na Play Store.
4. Abra o **CuePoint** e siga o cartão de configuração no topo da tela:
   - **Acesso às notificações:** é assim que o CuePoint descobre qual faixa o app do SoundCloud
     está tocando. Ele só lê a sessão de mídia do SoundCloud.
   - **Permissão de notificações:** para mostrar a notificação com ✓ / ✗.
   - **Xiaomi, Redmi e POCO (HyperOS/MIUI):** libere também o **início automático** e coloque o
     app **sem restrições** na economia de bateria. Sem isso o sistema desliga a leitura.

**Atualizar:** instale o APK novo por cima. Os dados são mantidos. Depois de atualizar, abra o app
uma vez.

## 5. Usar no celular

1. Abra o app do **SoundCloud** e dê play.
2. A **notificação do CuePoint** mostra a faixa com **✗**, **✓** e, depois de aprovar,
   **Categorias**. Dá para classificar pela cortina de notificações sem abrir o app.
3. A aba **Curar** do app mostra a faixa atual com capa, a pesquisa ativa, ✓ / ✗, as categorias e o
   botão **Abrir no SoundCloud**.
4. As abas **Pesquisas**, **Músicas**, **Categorias** e **Playlists** funcionam como a biblioteca
   do Chrome.
5. Faixa não identificada? No SoundCloud, use **Compartilhar → CuePoint**, ou toque em **Informar
   faixa manualmente** na aba Curar.

## 6. Sincronizar celular e PC

A sincronização acontece direto pela rede de casa: celular e PC precisam estar **na mesma rede
Wi-Fi** (o PC pode estar no cabo do mesmo roteador). Nenhum dado passa pela internet.

### 6.1 Instalar o serviço do PC (uma vez)

O Chrome sozinho não consegue receber conexões do celular. Por isso existe um pequeno serviço do
Windows que roda em segundo plano.

1. Instale o **Node.js LTS** (22.13 ou mais novo) em [nodejs.org](https://nodejs.org), com as opções
   padrão.
2. Baixe `cuepoint-servico-pc-1.0.0.zip` e extraia.
3. Dê dois cliques em **`Instalar.cmd`**. Não precisa de administrador. Se o Windows perguntar se
   quer executar o arquivo baixado, confirme.
   - O serviço é copiado para `%LOCALAPPDATA%\CuePoint` e inicia junto com o Windows.
4. Em `chrome://extensions`, clique em ↻ no CuePoint. Em **Biblioteca → Dispositivos**, o serviço
   deve aparecer como **conectado**.

### 6.2 Parear o celular

1. No PC: **Biblioteca → Dispositivos → Adicionar dispositivo**. Aparece um QR Code válido por 5
   minutos.
2. No celular: **Configurações → Dispositivos e sincronização → Parear com PC** e aponte a câmera
   para o QR.
3. Confira se os dois mostram o **mesmo código de 6 dígitos** e confirme no PC.
4. Escolha como sincronizar:
   - **automática**;
   - **pedir aprovação**: cada sincronização precisa de um toque em "Permitir" na notificação.
5. Na primeira conexão, o **Firewall do Windows** pode perguntar sobre o Node.js: permita em
   **redes privadas**.

Depois disso, a sincronização acontece sozinha: ao alterar algo, ao abrir o app e a cada 15 minutos.
Se o mesmo item for alterado nos dois aparelhos antes de sincronizar, aparece um **conflito**. Ele
fica com um contador na biblioteca e no app, e você escolhe qual valor fica.

**Remover o serviço:** `Desinstalar.cmd`, na mesma pasta. Os dados ficam em
`%LOCALAPPDATA%\CuePoint`.

## 7. Backup

O backup é um arquivo `cuepoint-backup-AAAAMMDD-hhmmss.json` com toda a biblioteca. O formato é o
mesmo no Chrome e no celular.

- **Chrome:** automático todo dia e a cada 100 alterações, em `Downloads\CuePoint\backups`. Para
  fazer um na hora ou restaurar: **Biblioteca → Backup**.
- **Celular:** em **Configurações → Backup e restauração**:
  - toque em **Escolher pasta** (ex.: `Documents`) para o backup sobreviver se o app for
    desinstalado;
  - o backup automático é diário e a cada 100 alterações;
  - **Restaurar de um arquivo…** aceita backups do celular ou do PC.
- **Restaurar é seguro:**
  - o arquivo é conferido antes (integridade, formato e referências);
  - um backup de segurança do estado atual é feito;
  - só então a biblioteca é substituída, de uma vez.
- Backups antigos nunca são apagados automaticamente.

> No Chrome, restaure só backups feitos no Chrome. Um backup do celular restaurado no PC faz o PC
> assumir a identidade do celular. No celular, qualquer backup pode ser restaurado.

**Trocar de celular:** faça um backup numa pasta fora do app e copie o arquivo para o celular novo.
Instale o app, restaure o backup e pareie de novo com o PC. No PC, em **Dispositivos**, revogue o
celular antigo.

## 8. Problemas comuns

| Sintoma                                                       | O que fazer                                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O widget não aparece no SoundCloud                            | Recarregue a aba do SoundCloud (F5). Confira em `chrome://extensions` se o CuePoint está ligado.                                                                                 |
| **Dispositivos** mostra o serviço auxiliar como "não instalado" | Normal se você não instalou o serviço do PC (seção 6.1). Se instalou, clique em ↻ no CuePoint em `chrome://extensions`.                                                          |
| `Instalar.cmd` diz que o Node.js não foi encontrado ou é antigo | Instale o Node.js LTS em [nodejs.org](https://nodejs.org), feche a janela e rode `Instalar.cmd` de novo.                                                                         |
| O celular não encontra o PC                                   | Os dois precisam estar na mesma rede (rede de convidados isola os aparelhos). Permita o Node.js no Firewall do Windows em redes privadas. Abra o app do CuePoint para forçar uma tentativa. |
| A notificação do CuePoint não aparece no celular              | Confira o cartão de configuração no app: acesso às notificações, permissão de notificações e, em Xiaomi, início automático e bateria sem restrições. Depois abra o app uma vez. |
| A notificação some da tela bloqueada                          | Limitação de alguns sistemas, como o HyperOS: ela some quando chega outra notificação. Continua disponível na cortina.                                                             |
| Uma faixa aparece como "provisória"                           | O identificador do SoundCloud ainda não foi obtido. Ela se resolve sozinha ou por **Identificar pela URL**.                                                                       |

## 9. Roadmap

- **Integração com o SoundCloud para criar e atualizar playlists**: enviar as playlists do
  CuePoint direto para a sua conta e mantê-las atualizadas.
- Sincronização direta entre dois celulares.
- Compartilhamento de bibliotecas por convite.
- Múltiplos dispositivos.

## 10. Para desenvolvedores

Monorepo com a extensão (TypeScript, React, Vite), o serviço do PC (Node 22) e o app Android
(Kotlin, Compose, Room). Um contrato comum em `spec/` garante que o Chrome e o Android mesclam os
dados do mesmo jeito.

| Caminho              | Conteúdo                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| `packages/core`      | Domínio: ids, relógio HLC, log de operações, mesclagem, backup         |
| `packages/extension` | Extensão Chrome MV3: widget no SoundCloud, biblioteca, popup           |
| `packages/helper`    | Serviço do Windows: Native Messaging, sincronização na rede, pareamento |
| `android/`           | App Android, ver [android/README.md](android/README.md)                |
| `spec/`              | JSON Schemas e vetores de teste compartilhados TS ⇄ Kotlin             |
| `scripts/`           | Ambiente, Gradle, instalação do serviço e empacotamento da release     |

Requisitos: Node 22.13+, npm e Chrome. Para o Android: Android Studio (o JBR) e o SDK 35.

```powershell
npm install
npm run verify:env       # confere Node, Chrome, JBR, SDK e Gradle
npm run build            # extensão em packages/extension/dist e serviço em packages/helper/dist
npm test                 # testes unitários (Vitest)
npm run lint             # ESLint + Prettier
npm run e2e              # Playwright: widget, biblioteca, backup e critérios de aceite
npm run android:check    # testes + APK de debug do Android
npm run helper:install   # instala o serviço do PC a partir do repositório
npm run release:package  # monta os arquivos da release em release\<tag>\
```

Mais contexto: [PRD](CuePoint_PRD_v1.0.md) · [planejamento e status](PLANEJAMENTO.md) ·
[contrato TS ⇄ Kotlin](spec/README.md).
