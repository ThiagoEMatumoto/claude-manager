# claude-manager

Gerenciador visual para múltiplas sessões do Claude Code, projetos e configs. App Electron com React no renderer, SQLite local para persistência e PTY para sessões de shell por repositório.

## Requisitos

- Node 20+ (recomendado via `nvm use --lts`)

## Setup

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Esse é o único comando necessário para iterar. O `electron-vite dev` sobe o app com HMR — mudanças no código React (renderer) recarregam em segundos sem reiniciar a janela.

Mudanças no main process (`electron/main/**`) ou no preload (`electron/preload/**`) exigem reiniciar: `Ctrl+C` no terminal e rodar `npm run dev` de novo.

## Estrutura

```
electron/
  main/        # processo principal: db, pty-manager, ipc handlers
  preload/     # bridge contextIsolation
shared/
  types/       # tipos compartilhados main ↔ renderer
src/
  app/         # App.tsx (root)
  features/    # projects, sessions
  lib/         # ipc helpers
```

## Status

D0 completo:
- App abre via `npm run dev`
- Projetos e repos persistem em SQLite
- Sessões bash via PTY funcionam (spawn, write, resize, kill)

Próximo: D1.
