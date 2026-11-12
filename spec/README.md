# spec — contrato compartilhado TS ⇄ Kotlin

Arquivos gerados a partir de `packages/core` e consumidos pelas suítes de teste do TypeScript
(Vitest) e do Kotlin (JUnit, módulo `android/core`). As duas implementações precisam chegar
ao mesmo resultado.

| Arquivo                       | Conteúdo                                                        |
| ----------------------------- | --------------------------------------------------------------- |
| `schema/entities.schema.json` | JSON Schema dos dados de domínio de cada entidade sincronizada  |
| `schema/op.schema.json`       | JSON Schema da operação do log (SyncEvents)                     |
| `vectors/ids.json`            | Ids determinísticos (UUIDv5) e formato textual do HLC           |
| `vectors/merge.json`          | Cenários de mesclagem: operações de entrada e estado esperado   |
| `vectors/backup.json`         | Backup `cuepoint-backup` v1 válido e variantes inválidas        |
| `vectors/isolation.json`      | Isolamento por usuário: operações aceitas/recusadas e pareamento |
| `vectors/backup-android.json` | Backup gerado pelo app Android (pela suíte Kotlin)              |
| `vectors/soundcloud.json`     | API do SoundCloud: pedidos de token (Basic só em `client_credentials`), URL de login, PKCE, caminhos, corpo da playlist e diferença de faixas |

Regenerar após uma mudança intencional no modelo ou no motor de mesclagem:

```powershell
npm run vectors -w @cuepoint/core
```

`backup-android.json` é gerado pelo teste `BackupTest` do Android quando o arquivo não existe:
apague-o e rode `android\gradlew.bat -p android test` para regenerar.

## Regras do motor de mesclagem (resumo)

- Cada campo guarda a fronteira de versões (`_v[campo]`, lista de HLCs).
- Uma operação traz, por campo, a fronteira que o autor via (`base`).
- Se `base` cobre a fronteira local, a escrita a substitui; senão os valores ficam como candidatos
  concorrentes (`_c[campo]`). Valores divergentes = conflito; vale provisoriamente o de maior HLC.
- `deleted_at`: exclusões concorrentes são equivalentes; excluir × editar vira conflito
  (toda escrita que não é exclusão grava `deleted_at = null`).
- Campos LWW (sem conflito): `decision.device_source` e metadados da faixa
  (`title`, `artist`, `soundcloud_url`, `artwork_url`, `metadata_source`).
- Entrega causal: operações aplicadas em ordem de HLC, sem lacunas de `seq` por origem;
  reentregas são ignoradas.
