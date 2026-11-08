# CuePoint

Ferramenta pessoal de curadoria musical sobre o SoundCloud: aprove (✓) ou rejeite (✗) faixas
durante a reprodução, organize-as por **pesquisas** e **categorias** e mantenha uma biblioteca local.

- Produto: [CuePoint_PRD_v1.0.md](CuePoint_PRD_v1.0.md)
- Planejamento e status das sprints: [PLANEJAMENTO.md](PLANEJAMENTO.md)

## Estrutura

| Caminho              | Conteúdo                                                        |
| -------------------- | --------------------------------------------------------------- |
| `packages/core`      | Domínio em TypeScript (ids, HLC, log de operações, mesclagem)   |
| `packages/extension` | Extensão Chrome MV3: widget no SoundCloud, biblioteca e popup    |
| `spec/`              | Contrato compartilhado TS ⇄ Kotlin (schemas e vetores de teste) |
| `android/`           | App Android (Kotlin, Compose, Room) — fase P2                   |
| `scripts/`           | Verificação de ambiente e utilitários                           |

## Requisitos

- Node ≥ 22 e npm
- Google Chrome
- Para o Android: Android Studio (JBR) e Android SDK com a plataforma 35

Verifique tudo com:

```powershell
npm install
npm run verify:env
```

## Comandos

```powershell
npm run build          # gera a extensão em packages/extension/dist
npm test               # testes unitários (Vitest)
npm run lint           # ESLint + Prettier
npm run typecheck      # TypeScript
npm run e2e            # testes ponta a ponta da extensão (Playwright)
npm run android:check  # testes + assembleDebug do Android (usa o JBR)
```

## Instalar a extensão no Chrome

1. `npm run build`
2. Abra `chrome://extensions`, ative o **Modo do desenvolvedor**.
3. **Carregar sem compactação** → selecione `packages/extension/dist`.

O ID da extensão é fixo (`daaemjinbpmlbffnjbbonliiglbmjjmn`), definido pela chave do manifesto.
