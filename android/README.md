# CuePoint — app Android

App de curadoria no celular: lê a faixa do SoundCloud pela sessão de mídia, mostra a notificação
com ✓ / ✗ / Categorias, guarda a biblioteca no Room e sincroniza com o PC pela rede local.

## Módulos

| Módulo  | Conteúdo                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ |
| `:core` | Kotlin/JVM puro: ids, HLC, mesclagem, protocolo, assinatura e backup. Testado com `spec/vectors` |
| `:app`  | Android: Room, Compose, leitura da sessão de mídia, notificação, sincronização e backup          |

## Requisitos

- Android Studio (o build usa o JBR dele: o `java` do sistema não serve para o AGP).
- Android SDK com a plataforma 35 (`android/local.properties` com `sdk.dir`, fora do git).
- Celular com Android 8.0 ou mais novo (minSdk 26).

## Build e testes

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
android\gradlew.bat -p android test assembleDebug     # testes (:core e :app) + APK de debug
android\gradlew.bat -p android assembleRelease        # APK de release assinado
```

Da raiz também dá para usar `npm run android -- <tarefas>` e `npm run android:check`.

Saídas:

- debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- release: `android/app/build/outputs/apk/release/app-release.apk`

## Assinatura do release

A chave fica **fora do git** (`.gitignore`): `android/cuepoint-release.keystore` e
`android/keystore.properties`:

```properties
storeFile=cuepoint-release.keystore
storePassword=…
keyAlias=cuepoint
keyPassword=…
```

Sem o `keystore.properties`, o `assembleRelease` gera um APK sem assinatura. **Guarde uma cópia
da chave e da senha em lugar seguro**: atualizações do app precisam ser assinadas com a mesma
chave. Uma chave perdida obriga a desinstalar o app, e isso apaga os dados do celular.

Conferir a assinatura:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.1\apksigner.bat" verify --print-certs android\app\build\outputs\apk\release\app-release.apk
```

## Instalação manual

```powershell
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

O debug e o release têm **assinaturas diferentes**: o Android não instala um por cima do outro.
Para trocar o debug pelo release sem perder dados, primeiro faça um backup (abaixo), desinstale,
instale o release e restaure o backup.

Depois de instalar, abra o app e libere o **acesso às notificações** e a permissão de
**notificações**. No HyperOS/MIUI, libere também o **início automático** e tire o app da
**economia de bateria**. O próprio app mostra um cartão com esses ajustes.

## Backup

**Configurações → Backup e restauração.**

- **Formato:** `cuepoint-backup` v1, o mesmo do Chrome. Um JSON com todas as tabelas, o log de
  operações e o SHA-256 do conteúdo canônico. Backup do PC restaura no celular e vice-versa.
- **Pasta:** escolhida pelo usuário no seletor do sistema (ex.: `Downloads/CuePoint`). Sem pasta,
  os arquivos ficam no armazenamento do app (`Android/data/com.elfo170.cuepoint/files/backups`),
  e essa pasta é apagada na desinstalação.
- **Automático:** diário e a cada 100 alterações, só quando houve mudança. Pode ser desligado.
- **Restauração:** confere checksum, formato e referências antes de mexer em qualquer coisa,
  faz um backup de segurança (`…-antes-de-restaurar.json`) e substitui a biblioteca numa única
  transação. O celular **mantém o próprio id, as chaves e os pareamentos** e adota o usuário do
  backup.
- Backups antigos nunca são apagados.

## Diagnóstico (adb, só leitura)

```powershell
adb logcat -s CuePointSync CuePointMedia CuePointBackup
```

- `CuePointSync`: descoberta e sincronização.
- `CuePointMedia`: metadados lidos da sessão do SoundCloud.
- `CuePointBackup`: falhas do backup automático.
