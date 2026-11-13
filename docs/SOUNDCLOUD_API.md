# API do SoundCloud no CuePoint

Validação da API oficial (PRD §11.2) e de como o CuePoint a usa. Fontes: OpenAPI
(`https://developers.soundcloud.com/docs/api/explorer/api.json`, conferida em 11/11/2026 e de novo
em 12/11/2026, antes da Sprint 16: endpoints, parâmetros e esquemas usados sem mudança), API
Guide, Terms of Use e Rate limits. Decisões vigentes e o prompt original da integração: seção
*SoundCloud* do [PLANEJAMENTO.md](../PLANEJAMENTO.md).

A forma dos pedidos (token, login, caminhos, corpo da playlist, diferença de faixas) é definida uma
vez em `packages/core/src/soundcloud.ts`. O app Android usa o espelho Kotlin
(`SoundCloudProtocol`), e a paridade é conferida por `spec/vectors/soundcloud.json`.

> ⚠️ **Exportar para o SoundCloud exige Artist Pro.** Sem servidor do CuePoint (PRD §15), cada
> pessoa registra o **próprio** app na API, e registrar exige Artist Pro. Sem isso, ficam os
> exports locais (links, CSV, JSON), que nunca dependem da API (PRD §11.3).

## O que o CuePoint faz com a API

| Ação (sempre iniciada pelo usuário) | Endpoint | Observação |
|---|---|---|
| Conferir credenciais do app | `POST https://secure.soundcloud.com/oauth/token` `grant_type=client_credentials` | Uma vez, ao salvar. App em **HTTP Basic** (no corpo dá 401). O token não é usado nem guardado |
| Entrar | `GET https://secure.soundcloud.com/authorize` (PKCE S256 + `state`) | Retorno em `http://127.0.0.1:47801/callback` |
| Trocar o código / renovar | `POST /oauth/token` `authorization_code` / `refresh_token` | `client_id` e `client_secret` **no corpo** (Basic dá `invalid_request`); `redirect_uri` também na renovação |
| "Conectado como @…" | `GET /me` | Nome mantido só em memória |
| Faixa sem URN | `GET /resolve?url=` | Responde 302; o serviço segue o `location` |
| Criar playlist | `POST /playlists` | `{"playlist":{title, description, sharing, tracks:[{urn}]}}`, privada por padrão |
| Comparar antes de atualizar | `GET /playlists/{urn}/tracks?access=playable,preview,blocked&linked_partitioning=true` | Sem `access`, a API omite faixas `blocked`; segue `next_href` |
| Atualizar (espelhar) | `PUT /playlists/{urn}` | Mesmo corpo, sem `sharing` (não muda a visibilidade) |
| Desconectar | `POST /disconnect` | 204; depois os tokens são apagados do PC |

Cabeçalho das chamadas: `Authorization: OAuth <access_token>`. Base: `https://api.soundcloud.com`.

> **Divergência da OpenAPI (conferida na API real em 11/11/2026):** o esquema `OAuthToken` põe
> `client_id`/`client_secret` no corpo em todas as trocas, mas `client_credentials` só aceita o app
> em HTTP Basic, como no exemplo do API Guide. A renovação aceita o corpo e recusa Basic.

## Onde cada coisa fica

- **Credenciais do app** (`client_id`, `client_secret`) e **tokens** no PC: no serviço do PC
  (`%LOCALAPPDATA%\CuePoint\helper.db`, chave `sc:secrets`), cifrados com o **DPAPI** do Windows
  (conta do usuário). A extensão repassa o que a pessoa digita e não guarda nada. No celular:
  Android Keystore (ver *No celular*). Cada aparelho tem os próprios tokens.
- **Sincroniza** só o URN da playlist exportada (`external_playlist_id` da Playlist), para PC e
  celular atualizarem a mesma playlist. Credenciais nunca passam pela sync.
- **Entrega ao celular** (Sprint 16): em Configurações → Exportar para o SoundCloud → *Usar no
  celular*, **Enviar para <aparelho>** libera as credenciais do app por **10 minutos, uma única
  vez**. No celular, **Receber do PC** faz `POST /v1/sc/credentials` ao serviço do PC:
  - a requisição é assinada pelo aparelho e chega por HTTPS com o certificado do PC fixado pelo QR;
  - só vale para par `paired` do mesmo usuário;
  - sem liberação válida → 409 `sc_not_shared`; sem credenciais no PC → 404 `sc_not_configured`.

  A liberação fica só na memória do serviço e é cancelada ao trocar ou remover as credenciais. Os
  **tokens não são enviados**: o celular faz o próprio login.

## No celular (Sprint 16)

O app Android exporta e atualiza playlists sem o PC ligado, com os mesmos endpoints, regras e
mensagens do serviço do PC (`soundcloud/` no app):

- **Credenciais:** recebidas do PC (acima) ou digitadas. São validadas uma vez com
  `client_credentials` (Basic) e guardadas cifradas com o **Android Keystore**: AES-256-GCM, chave
  `cuepoint.sc` que não sai do aparelho. Ficam no `meta` do banco (`sc.vault`), fora do backup e
  da sincronização; o app tem `allowBackup="false"`.
- **Login:** PKCE S256 + `state`, com retorno no mesmo endereço do PC
  (`http://127.0.0.1:47801/callback`). Um servidor local do app atende só durante o login (até
  5 min) e só em 127.0.0.1. A página de retorno tem **Voltar ao CuePoint** (`cuepoint://soundcloud`).
- **Tokens deste aparelho:** renovação em execução única, Reconectar sem repetir em loop,
  Desconectar (`POST /disconnect` + apagar) e Remover credenciais, como no PC.
- **Exportar:** o cartão da playlist cria (privada por padrão) ou espelha com prévia do que entra e
  do que sai. O URN (`external_playlist_id`) sincroniza com o PC.
- **Paridade:** pedidos de token, URL de login, caminhos, corpo e diferença vêm de
  `SoundCloudProtocol`, conferido por `spec/vectors/soundcloud.json`.
- Nada mais vindo da API é gravado (Termos: sem armazenar "User Content").
- Desenvolvimento: `SC_CLIENT_ID`/`SC_CLIENT_SECRET` no `.env` da raiz, lidos só por
  `npm run sc:dev`. Nunca com prefixo `VITE_`; nunca no build.

## Comportamento

- **Renovação:** quando faltam menos de 5 min para o access token vencer (~1 h), uma única
  renovação por vez (o refresh token é de uso único).
- **Acesso caído** (`invalid_grant`/`invalid_client`, ex.: Artist Pro vencido ou senha do app
  trocada): apaga os tokens, mostra **Reconectar** e não tenta de novo sozinho.
- **401** numa chamada: uma renovação forçada e nova tentativa. **429**: espera 1 s, 2 s e 4 s e
  então desiste com mensagem clara.
- **Espelho:** antes de atualizar, a página da playlist mostra o que entra, o que sai e se a ordem
  muda; só grava depois da confirmação. Depois do `PUT`, o serviço relê a playlist e avisa se a
  lista no SoundCloud ficou diferente da enviada.
- **Faixas puladas:** sem URN e sem link, ou link que o `/resolve` não encontra. Aparecem na tela.
- Playlist apagada no SoundCloud: a comparação avisa e oferece **Criar outra**.

## Termos de uso (checklist)

- [x] Só ações iniciadas pelo usuário (nenhuma chamada automática ou em segundo plano).
- [x] Botão **Desconectar** (`/disconnect` + apagar tokens) e **Remover credenciais**.
- [x] Dados da API não persistidos além do URN da playlist; ao desconectar, os tokens somem na hora
  (prazo dos Termos: 7 dias).
- [x] Política de privacidade: [PRIVACIDADE.md](PRIVACIDADE.md).
- [x] Nome do app sem a marca SoundCloud (o assistente sugere "CuePoint"); sem anúncios.
- [x] Nenhum `client_id`/`client_secret` no repositório nem nos builds.
- [x] Não automatiza o site do SoundCloud para quem não tem Artist Pro.

## Limites

Por `client_id`, na ordem de 100 requisições por minuto (sujeito a mudança). Exportar uma playlist
custa 1 chamada de gravação, 1 leitura por página da lista para conferir e 1 `/resolve` por
faixa sem URN. Sem limite documentado de faixas por playlist.

## Resultados com credenciais reais

Rodar `npm run sc:dev` (com `--other <link>` e `--blocked <link>` opcionais). O script cria uma
playlist **privada** de teste, aplica os cenários, apaga a playlist e revoga os tokens.

| Item | Resultado |
|---|---|
| Endereço de retorno `http://127.0.0.1:47801/callback` aceito no cadastro | ✅ 11/11/2026 |
| Credenciais conferidas com `client_credentials` (HTTP Basic) | ✅ 11/11/2026 |
| Login completo no PC (PKCE, retorno local, `GET /me`) | ✅ 11/11/2026 |
| `POST /playlists` privada, com 3 faixas próprias `playable` | ✅ criada e conferida |
| `PUT` substitui a lista (remove e reordena) | ✅ **Sim**: a lista ficou exatamente a enviada (o espelho funciona) |
| `DELETE /playlists/{urn}` e `POST /disconnect` | ✅ |
| Faixa de outro artista na playlist (link resolvido por `/resolve`) | ✅ aceita e aparece na playlist |
| Faixa `blocked` na playlist | Não será testado (decisão de 12/11/2026) |
| `you/apps` no navegador do celular | Não será testado (decisão de 12/11/2026); o caminho principal é criar o app no PC |
| Credenciais recebidas do PC pelo celular (liberação de uso único) | ✅ 12/11/2026 |
| Login no celular com retorno em `127.0.0.1:47801` | ✅ 12/11/2026 (Redmi Note 14 Pro 5G, HyperOS 2) |
| Exportar e atualizar pelo celular com o PC desligado | ✅ 12/11/2026 (PC e celular atualizam a mesma playlist) |
| Credenciais com Artist Pro vencido | Não testável; tratado como "Reconectar" |
