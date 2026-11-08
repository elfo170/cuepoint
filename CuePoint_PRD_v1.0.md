# CuePoint

## Product Requirements Document (PRD)

**Versão:** 1.0\
**Data:** 08/11/2026\
**Status:** Requisitos definidos --- pronto para planejamento técnico e
validação do MVP.

------------------------------------------------------------------------

## 1. Visão do produto

O **CuePoint** é uma ferramenta de pesquisa e curadoria musical que
permite classificar rapidamente faixas durante a reprodução de playlists
do SoundCloud.

O produto será desenvolvido inicialmente para Chrome no Windows, com
expansão posterior para Android. O SoundCloud continuará sendo o player
principal; o CuePoint adicionará uma camada independente de organização,
classificação e histórico musical.

O sistema permitirá criar pesquisas, aprovar ou rejeitar faixas durante
a reprodução, organizar músicas em categorias, consultar a biblioteca e
sincronizar dados entre dispositivos na mesma rede Wi-Fi.

### 1.1. Problema

Curtidas e playlists convencionais do SoundCloud não oferecem
organização suficientemente granular para pesquisas musicais. Uma mesma
música pode ser interessante em uma pesquisa e irrelevante em outra.

O CuePoint resolve isso separando a identidade da música da decisão
tomada em cada pesquisa.

### 1.2. Público inicial

Uso pessoal, com arquitetura preparada para futura utilização por
terceiros.

------------------------------------------------------------------------

## 2. Princípios fundamentais

1.  **SoundCloud continua sendo o player:** não haverá player próprio no
    MVP.
2.  **Curadoria independente:** os dados do CuePoint não dependem das
    curtidas do SoundCloud.
3.  **Decisões contextualizadas:** uma música pode ser aprovada em uma
    pesquisa e rejeitada em outra.
4.  **Operação rápida:** classificação com poucos toques e sem
    interromper a reprodução.
5.  **Dados locais primeiro:** cada dispositivo mantém sua própria base
    de dados.
6.  **Sincronização sem servidor externo:** comunicação direta entre
    dispositivos na mesma rede.
7.  **Preservação:** nenhum dado será apagado automaticamente por
    antiguidade ou por já ter sido sincronizado.
8.  **Arquitetura extensível:** possibilidade de adicionar usuários,
    dispositivos e recursos futuramente.

------------------------------------------------------------------------

## 3. Plataformas e arquitetura de produto

### 3.1. Primeira etapa

-   Extensão Chrome para Windows.
-   Interface web local para gerenciamento da biblioteca.
-   Banco de dados local.
-   Serviço auxiliar local para sincronização entre dispositivos.

### 3.2. Segunda etapa

-   Aplicativo Android nativo em Kotlin.
-   Banco SQLite com Room.
-   Integração com a reprodução do SoundCloud.
-   Sincronização com a instalação do Chrome.

### 3.3. Evolução futura

-   Suporte a múltiplos usuários.
-   Compartilhamento de bibliotecas.
-   Novas integrações musicais.
-   Recursos avançados de análise e organização.

### 3.4. Arquitetura preliminar

  Componente          Tecnologia proposta
  ------------------- ------------------------------------------------
  Extensão Chrome     TypeScript + Manifest V3
  Interface web       React + TypeScript
  Estilização         Tailwind CSS
  Banco no PC         IndexedDB ou SQLite via serviço local
  Android             Kotlin + Room
  Banco Android       SQLite
  Comunicação local   API HTTP/HTTPS na LAN
  Descoberta          mDNS / DNS-SD
  Pareamento          QR Code + chaves criptográficas
  Sincronização       Protocolo de eventos e alterações incrementais

A extensão Chrome não deve ser tratada como servidor de rede permanente.
A implementação poderá exigir um serviço auxiliar no Windows, integrado
à extensão por Native Messaging ou mecanismo equivalente. A escolha
definitiva será validada durante a prova de conceito.

------------------------------------------------------------------------

## 4. Identidade, usuários e dispositivos

### 4.1. Contas

O MVP não exigirá criação de conta. Cada instalação terá identidade
própria e manterá sua biblioteca local.

A arquitetura deverá permitir futuramente identificação de usuários,
isolamento de bibliotecas, autenticação e compartilhamento mediante
convite.

### 4.2. Modelo multiusuário futuro

Cada usuário terá uma biblioteca privada inicialmente. O
compartilhamento entre usuários poderá ser desenvolvido posteriormente,
mediante convite e autorização explícita.

### 4.3. Dispositivos

O sistema permitirá múltiplos dispositivos pareados, sem limite
estrutural de dois aparelhos. Cada dispositivo terá:

-   Identificador único.
-   Chave criptográfica própria.
-   Nome automático inicial, personalizável.
-   Estado de pareamento.
-   Política individual de sincronização.
-   Histórico de sincronizações.

### 4.4. Pareamento por QR Code

1.  O usuário seleciona "Adicionar dispositivo".
2.  O dispositivo gera um QR Code temporário e de uso único.
3.  O outro dispositivo escaneia o código.
4.  Os dispositivos estabelecem confiança e trocam informações de
    identificação.
5.  O usuário confirma o pareamento.
6.  O dispositivo passa a integrar a rede autorizada.

O QR Code não transportará a biblioteca musical. Será utilizado para
estabelecer confiança entre os aparelhos. Novos dispositivos poderão ser
adicionados sem refazer os pareamentos anteriores.

### 4.5. Revogação

O usuário poderá remover um dispositivo pareado. A revogação deverá
impedir novas sincronizações e invalidar as credenciais daquele
dispositivo.

------------------------------------------------------------------------

## 5. Sincronização entre dispositivos

### 5.1. Modelo

Sincronização peer-to-peer, diretamente pela rede Wi-Fi local, sem
dependência de VPS ou servidor externo. Todos os dispositivos poderão
atuar como clientes e servidores.

### 5.2. Descoberta

Os dispositivos procurarão automaticamente outros aparelhos pareados na
mesma rede utilizando descoberta de serviços locais, preferencialmente
mDNS/DNS-SD.

### 5.3. Política de autorização

A autorização será configurável individualmente por dispositivo:

-   Sincronização automática autorizada.
-   Exigir aprovação antes de cada sincronização.

Novos dispositivos sempre exigirão pareamento e aprovação inicial.

### 5.4. Fluxo de sincronização

1.  Identificar dispositivos pareados na rede.
2.  Verificar a política de autorização.
3.  Identificar alterações pendentes.
4.  Solicitar aprovação, quando necessário.
5.  Trocar somente os dados novos ou modificados.
6.  Resolver conflitos.
7.  Registrar o resultado da sincronização.

Quando um dispositivo retornar à rede após um período desconectado, suas
alterações pendentes deverão ser sincronizadas, respeitando sua política
de autorização.

### 5.5. Dados sincronizados

Todos os dados relevantes da biblioteca:

-   Pesquisas.
-   Músicas.
-   Decisões.
-   Categorias.
-   Classificações.
-   Playlists internas.
-   Histórico e configurações relevantes.

### 5.6. Resolução de conflitos

O sistema deverá mesclar alterações compatíveis automaticamente.

-   Categorias diferentes adicionadas em dispositivos distintos:
    preservar ambas.
-   Alterações em campos independentes: mesclar.
-   Registros independentes: combinar.
-   Alterações incompatíveis no mesmo campo: solicitar intervenção do
    usuário.

Nenhuma alteração conflitante deverá ser descartada silenciosamente. As
decisões de curadoria serão identificadas pela combinação de música e
pesquisa; decisões de pesquisas diferentes não representam conflitos.

### 5.7. Exclusões e preservação

A exclusão explícita de um registro deverá ser propagada aos demais
dispositivos. O sistema deverá distinguir exclusão solicitada pelo
usuário de limpeza automática.

-   Não apagar dados automaticamente por antiguidade.
-   Não apagar dados simplesmente porque já foram sincronizados.
-   Registrar exclusões para propagação aos demais aparelhos.
-   Manter os dados locais enquanto não houver ação explícita de
    exclusão.

### 5.8. Backup

O sistema deverá oferecer backup automático em arquivos locais, com
suporte a restauração e proteção contra corrupção dos arquivos.

------------------------------------------------------------------------

## 6. Modelo de dados

### 6.1. Entidades principais

**Users** - id - created_at

Prevista para evolução multiusuário.

**Devices** - id - user_id - device_name - public_key - pairing_status -
sync_policy - created_at - last_sync_at

**Tracks** - id - soundcloud_urn - soundcloud_url - title - artist -
artwork_url - metadata_source - created_at - updated_at

**Researches** - id - user_id - name - description - created_at -
updated_at

**Decisions** - id - user_id - track_id - research_id - decision
(boolean) - created_at - updated_at - device_source

**Categories** - id - user_id - name - description - created_at -
updated_at

**TrackCategories** - id - track_id - research_id - category_id -
created_at

**Playlists** - id - user_id - name - research_id - category_id -
external_playlist_id - created_at

**PlaylistTracks** - id - playlist_id - track_id - position

**SyncEvents** - id - device_id - entity_type - entity_id - operation -
timestamp - synchronization_status

O modelo deverá utilizar identificadores estáveis e operações
idempotentes para evitar duplicações durante sincronizações repetidas.

### 6.2. Regras de integridade

-   Uma música deverá existir uma única vez na biblioteca, sempre que
    sua identidade puder ser confirmada.
-   Uma decisão pertence a uma música e a uma pesquisa.
-   A decisão deverá ser booleana: `true` ou `false`.
-   Categorias serão globais e reutilizáveis entre pesquisas.
-   Uma música aprovada poderá receber várias categorias na mesma
    pesquisa.
-   Uma aprovação sem categoria será permitida, podendo ficar pendente
    de classificação.
-   Uma rejeição não implica exclusão da música da biblioteca nem
    rejeição global.

### 6.3. Histórico

O MVP não manterá histórico completo de versões das decisões. O sistema
armazenará registros e datas de criação e atualização necessárias para
sincronização, mas não oferecerá interface de auditoria de todas as
alterações.

------------------------------------------------------------------------

## 7. Pesquisas musicais

### 7.1. Criação

Cada pesquisa terá:

-   Nome livre.
-   Descrição opcional.
-   Data de criação.
-   Estado ativo ou arquivado, a definir na implementação.

Exemplos: Latin Bass, Techno Groovy, Peak Time, Techno com vocal e
pesquisas de drops específicos.

Não será obrigatório selecionar um gênero.

### 7.2. Independência

A decisão será independente em cada pesquisa.

  Música    Latin Bass   Techno Groovy
  --------- ------------ ---------------
  Faixa A   true         false
  Faixa B   false        true
  Faixa C   true         true

A mesma faixa poderá ser aprovada, rejeitada ou ainda não avaliada em
pesquisas diferentes.

### 7.3. Categorias

As categorias serão globais e reutilizáveis entre pesquisas. Uma música
poderá receber várias categorias dentro da mesma pesquisa. A aprovação
não dependerá da atribuição imediata de categorias.

------------------------------------------------------------------------

## 8. Identificação das músicas

### 8.1. Identificador principal

O identificador SoundCloud URN será a referência preferencial para
deduplicação.

### 8.2. Identificação incompleta

Quando não for possível obter identificação confiável, o sistema poderá
registrar uma faixa provisória com informações disponíveis, como título
e artista.

O sistema deverá permitir identificação ou associação posterior com um
registro definitivo. Não deverá realizar deduplicação aproximada
automaticamente sem confiança suficiente.

### 8.3. Metadados

Campos previstos:

-   Título.
-   Artista.
-   URL SoundCloud.
-   URN SoundCloud.
-   Capa.
-   Fonte da identificação.

A obtenção de metadados poderá variar entre Chrome e Android.

------------------------------------------------------------------------

## 9. Experiência no Chrome

### 9.1. Interface principal

Um widget flutuante e compacto sobre a interface do SoundCloud, sem
obstruir os controles importantes do player.

### 9.2. Informações exibidas

-   Música atual.
-   Artista.
-   Pesquisa ativa.
-   Estado da decisão.
-   Controles de aprovação e rejeição.

### 9.3. Controles

A interface utilizará ícones vetoriais:

-   Check: `true`.
-   X: `false`.

Não utilizar textos "SIM" e "NÃO" como controles principais nem emojis
no lugar dos ícones.

### 9.4. Aprovação

Ao aprovar uma faixa:

1.  Registrar `decision = true`.
2.  Abrir um seletor rápido de categorias.
3.  Permitir escolher uma ou várias categorias.
4.  Permitir fechar o seletor sem classificar.

### 9.5. Rejeição

Um toque no X deverá registrar imediatamente `decision = false`, sem
confirmação adicional.

### 9.6. Atalhos

Atalhos de teclado não fazem parte do MVP.

### 9.7. Identificação da faixa atual

A extensão deverá identificar a música em reprodução na página do
SoundCloud. A implementação poderá utilizar leitura do DOM e metadados
disponíveis na página.

Como o SoundCloud pode modificar sua estrutura, a identificação deverá
ser isolada em um módulo adaptável.

------------------------------------------------------------------------

## 10. Biblioteca e gerenciamento

A biblioteca será acessada por uma interface web local.

### 10.1. Funcionalidades

-   Visualizar todas as pesquisas.
-   Criar e editar pesquisas.
-   Consultar músicas aprovadas e rejeitadas.
-   Filtrar por categoria.
-   Consultar músicas pendentes de classificação.
-   Alterar classificações.
-   Visualizar playlists internas.
-   Consultar dispositivos pareados.
-   Gerenciar políticas de sincronização.
-   Consultar estado da última sincronização.

### 10.2. Organização

A navegação deverá priorizar pesquisa e categoria, mantendo a música
como entidade central da biblioteca.

------------------------------------------------------------------------

## 11. Integração com playlists do SoundCloud

O produto deverá prever integração com playlists externas.

### 11.1. Organização

O usuário poderá escolher a organização por pesquisa ou categoria.

### 11.2. Limitações

A integração dependerá das permissões e capacidades efetivamente
disponíveis na API oficial do SoundCloud.

Se determinada operação não for permitida pela API ou não houver
autorização técnica adequada, ela não será implementada. O sistema não
deverá prometer sincronização de playlists antes de validar as
permissões necessárias.

### 11.3. Independência

A indisponibilidade da API não poderá impedir a classificação e o
armazenamento local das músicas.

------------------------------------------------------------------------

## 12. Aplicativo Android

### 12.1. Tecnologia

Aplicativo nativo Kotlin, com banco SQLite por meio de Room.

### 12.2. Interface

O MVP Android utilizará uma notificação persistente com controles de
curadoria. A interface deverá permitir classificar músicas sem precisar
navegar constantemente entre o SoundCloud e o CuePoint.

### 12.3. Identificação musical

A identificação deverá utilizar os metadados disponíveis por mecanismos
como MediaSession e notificações.

Como esses mecanismos não garantem a disponibilidade do URN ou URL da
faixa, deverá existir suporte para identificação manual.

### 12.4. Identificação falha

Quando não for possível identificar a faixa:

-   Permitir informar manualmente.
-   Permitir aguardar a identificação automática.

### 12.5. Tela bloqueada

O aplicativo deverá funcionar com a tela bloqueada dentro das limitações
e permissões do Android. A implementação deverá validar restrições de
notificações, execução em segundo plano e acesso à sessão de mídia.

------------------------------------------------------------------------

## 13. Segurança e privacidade

-   Banco de dados local por dispositivo.
-   Pareamento autenticado por QR Code.
-   Chaves criptográficas individuais.
-   Comunicação autenticada entre dispositivos.
-   Não expor a biblioteca para dispositivos não autorizados.
-   Permitir revogação de dispositivos.
-   Proteger credenciais e tokens de integração.
-   Não exigir infraestrutura externa para sincronização local.

------------------------------------------------------------------------

## 14. Requisitos funcionais e prioridades

### P0 --- MVP Chrome

-   Criar e gerenciar pesquisas.
-   Criar categorias globais.
-   Identificar a faixa atual do SoundCloud.
-   Registrar aprovação e rejeição por pesquisa.
-   Armazenar decisão booleana.
-   Classificar músicas em múltiplas categorias.
-   Permitir aprovação sem categoria.
-   Registrar faixas provisórias.
-   Gerenciar biblioteca local.
-   Criar e gerenciar playlists internas.
-   Backup automático local.
-   Estrutura de dados preparada para sincronização.

### P1 --- Sincronização

-   Pareamento por QR Code.
-   Suporte a múltiplos dispositivos.
-   Descoberta local.
-   Sincronização peer-to-peer.
-   Políticas de autorização por dispositivo.
-   Sincronização incremental.
-   Mesclagem automática de alterações compatíveis.
-   Resolução manual de conflitos.
-   Propagação de exclusões.
-   Gerenciamento e revogação de dispositivos.

### P2 --- Android

-   Aplicativo Kotlin.
-   Identificação via MediaSession.
-   Notificação persistente.
-   Controles de aprovação e rejeição.
-   Classificação por categoria.
-   Operação com tela bloqueada.
-   Sincronização com Chrome.

### P3 --- Integrações e expansão

-   Integração com playlists SoundCloud, conforme permissões.
-   Suporte a múltiplos usuários.
-   Compartilhamento de bibliotecas.
-   Recursos avançados de organização.

------------------------------------------------------------------------

## 15. Fora do escopo do MVP

-   Player musical próprio.
-   Análise de áudio por IA.
-   Reconhecimento automático de drops.
-   Identificação automática de BPM.
-   Identificação automática de tonalidade.
-   Detecção de timestamps de drops.
-   Recomendações musicais.
-   Integração avançada com Rekordbox.
-   Atalhos de teclado.
-   Sincronização via nuvem.
-   Serviço de conta obrigatório.
-   Aplicativo Android antes da validação da primeira versão Chrome.

------------------------------------------------------------------------

## 16. Requisitos não funcionais

### Desempenho

-   A decisão deverá ser registrada localmente com baixa latência.
-   A interface não deverá interromper a reprodução musical.
-   A sincronização deverá transferir somente alterações necessárias.
-   A aplicação deverá continuar operando sem internet, desde que o
    SoundCloud não seja necessário para a identificação da faixa.

### Confiabilidade

-   Nenhuma decisão deverá ser perdida por falha temporária de conexão.
-   Sincronizações repetidas não deverão duplicar registros.
-   Alterações pendentes deverão permanecer armazenadas.
-   O sistema deverá tolerar dispositivos temporariamente indisponíveis.

### Segurança

-   Pareamento autenticado.
-   Comunicação protegida.
-   Isolamento por usuário na evolução multiusuário.
-   Proteção de credenciais.

### Portabilidade

-   Exportação e restauração de backup.
-   Identificadores independentes da plataforma.
-   Modelo de dados compartilhado entre Chrome e Android.

------------------------------------------------------------------------

## 17. Riscos e validações técnicas

### 17.1. SoundCloud

A disponibilidade e as permissões da API oficial deverão ser
verificadas. A leitura da faixa atual por DOM poderá exigir manutenção
quando a interface do SoundCloud mudar.

### 17.2. Android

MediaSession pode disponibilizar título e artista sem disponibilizar um
identificador exclusivo da faixa. A experiência de notificação
persistente e tela bloqueada deverá ser testada em dispositivo real.

### 17.3. Sincronização local

A comunicação peer-to-peer exige que os dispositivos estejam na mesma
rede e acessíveis. O Android pode restringir execução em segundo plano.
O serviço auxiliar do Windows também precisará de estratégia de
inicialização e disponibilidade.

### 17.4. Resolução de conflitos

A mesclagem precisa ser baseada em operações e identificadores estáveis,
não apenas em timestamps. Exclusões devem utilizar registros de
tombstone para que sejam propagadas mesmo quando um dispositivo estiver
desconectado.

### 17.5. Backup

Deverá ser validada a recuperação de uma biblioteca completa, incluindo
relacionamentos entre pesquisas, músicas, categorias e playlists.

------------------------------------------------------------------------

## 18. Critérios de aceite do MVP

O MVP Chrome será considerado funcional quando:

1.  O usuário conseguir criar uma pesquisa.
2.  O sistema identificar a faixa em reprodução no SoundCloud.
3.  O usuário conseguir aprovar a faixa com um toque.
4.  O usuário conseguir rejeitar a faixa com um toque.
5.  As decisões forem registradas como booleanos.
6.  A mesma faixa puder ter decisões diferentes em pesquisas diferentes.
7.  Uma faixa aprovada puder receber várias categorias.
8.  A faixa puder ser aprovada sem categoria.
9.  A biblioteca mantiver as informações após fechar e reabrir o
    navegador.
10. O usuário conseguir consultar e filtrar suas músicas.
11. O usuário conseguir criar e gerenciar playlists internas.
12. A aplicação não depender de servidor externo para as operações
    essenciais.

A etapa de sincronização será considerada validada quando dois
dispositivos pareados conseguirem trocar alterações pela rede local,
inclusive após períodos offline, sem duplicação ou perda silenciosa de
dados.

------------------------------------------------------------------------

## 19. Estratégia de desenvolvimento

### Fase 1 --- Prova de conceito Chrome

-   Criar extensão Manifest V3.
-   Detectar a música atual do SoundCloud.
-   Implementar widget flutuante.
-   Registrar decisões locais.
-   Validar comportamento em playlists reais.

### Fase 2 --- Motor de curadoria

-   Implementar pesquisas.
-   Implementar categorias globais.
-   Implementar classificações.
-   Implementar biblioteca web local.
-   Implementar backups.

### Fase 3 --- Sincronização

-   Implementar identidade dos dispositivos.
-   Criar pareamento QR Code.
-   Implementar descoberta local.
-   Criar protocolo de sincronização.
-   Implementar resolução de conflitos.
-   Testar com múltiplos dispositivos.

### Fase 4 --- Android

-   Criar aplicativo Kotlin.
-   Integrar MediaSession.
-   Implementar notificação persistente.
-   Implementar classificação.
-   Integrar sincronização local.

### Fase 5 --- Integrações e expansão

-   Validar API do SoundCloud.
-   Implementar operações de playlist autorizadas.
-   Preparar suporte multiusuário.
-   Avaliar novos recursos.

------------------------------------------------------------------------

## 20. Decisões consolidadas

  Tema                          Decisão
  ----------------------------- ------------------------------------------------------
  Nome do produto               CuePoint
  Plataforma inicial            Chrome
  Plataforma posterior          Android
  Player                        SoundCloud original
  Contas no MVP                 Não
  Evolução multiusuário         Bibliotecas privadas
  Banco de dados                Local em cada dispositivo
  Sincronização                 Peer-to-peer na mesma rede
  Servidor externo              Não necessário
  Dispositivos                  Múltiplos
  Pareamento                    QR Code
  Autorização de sync           Configurável por dispositivo
  Escopo de sync                Todos os dados
  Conflitos                     Mesclagem automática + intervenção quando necessário
  Exclusões                     Propagadas entre dispositivos
  Retenção                      Sem limpeza automática
  Backup                        Automático local
  Pesquisas                     Nome e descrição livres
  Categorias                    Globais e reutilizáveis
  Categorias por música         Múltiplas
  Aprovação sem categoria       Permitida
  Histórico de alterações       Não no MVP
  Faixas sem ID                 Registro provisório
  Interface Chrome              Widget flutuante
  Aprovação                     Abre seletor de categorias
  Rejeição                      Imediata
  Atalhos                       Fora do MVP
  Playlists                     Por pesquisa ou categoria
  API SoundCloud indisponível   Não implementar operação não suportada
  Android                       Notificação persistente
  Tela bloqueada                Suportada dentro das limitações do sistema
  Distribuição Android          APK manual
  Gerenciamento                 Interface web local
  Ordem de desenvolvimento      Chrome primeiro

------------------------------------------------------------------------

## Resultado esperado

O **CuePoint** será uma ferramenta pessoal de curadoria musical, rápida
e independente dos favoritos do SoundCloud, com biblioteca local
persistente, organização por pesquisas e categorias e arquitetura
preparada para sincronização entre dispositivos e expansão futura.
