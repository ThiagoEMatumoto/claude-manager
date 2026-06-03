---
name: drive-app
description: Use when you need to SEE or operate the claude-manager Electron app like a user — to validate a UI change, reproduce/diagnose a bug, or take screenshots. Launches the built app against a safe COPY of real data via Playwright, captures screenshots + logs.
---

# drive-app — dirigir o app como usuário

Ferramental pra você (Claude) abrir o app **claude-manager** real, navegar como usuário, tirar screenshots e ler logs — sem tocar nos dados reais. A engine fica em `e2e/` (Playwright + Electron).

## Como funciona (não-destrutivo por design)

- Lança o app **buildado** (`out/main/index.js`) via Playwright `_electron`.
- Antes de lançar, copia o `userData` real (`~/.config/claude-manager`, detectado pelo `app.db`) pra um dir temporário e roda com `--user-data-dir=<cópia>`. O SQLite e todo `app.getPath('userData')` apontam pra cópia → **os dados reais não são tocados**.
- Screenshots vão pra `.cm-drive/screenshots/` (gitignored); logs do renderer+main pra `.cm-drive/logs/`.

⚠️ **Limite de segurança:** a cópia protege o estado do app (DB), mas as linhas de `vault_path`/repos apontam pra pastas reais no disco. **Não execute ações destrutivas de filesystem** (mover vault, deletar repo) por enquanto — só navegação/leitura/validação visual. Cenários destrutivos seguros virão numa fase posterior (rewrite de paths).

## Pré-requisito: build atual

O driver precisa de `out/` buildado com os módulos nativos na ABI do Electron:

```bash
npm run rebuild:native && npm run build
```

Rode isso depois de mexer no código do app (main/renderer) ou se `out/` não existir. Se você só editou o driver (`e2e/`), não precisa rebuildar.

## Uso

### Validar (cenário pronto)

```bash
npm run drive
```

Abre o app, navega até Projetos, gera `.cm-drive/screenshots/01-initial.png` e `02-projects.png`. Depois **leia os PNGs** com a tool Read e descreva/valide o que vê.

### Ad-hoc (escrever um cenário na hora)

Crie um arquivo em `e2e/scenarios/<nome>.ts` usando os helpers e rode com `npx tsx e2e/scenarios/<nome>.ts`:

```ts
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, openSettings, waitReady } from '../driver/nav'

const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await goToArea(page, 'metrics')   // 'projects' | 'features' | 'cc-configs' | 'metrics'
  await screenshot(page, 'metrics')
} finally {
  stop(); await app.close()
}
```

Pra interações além dos helpers, use a API normal do Playwright no `page` (`page.getByRole`, `getByText`, `.click()`, `.fill()`). O app **não tem `data-testid`** — selecione por role/texto/title. Labels úteis: botões de área têm `title` ("Projetos", "Features", "Configs do CC", "Métricas", "Configurações"); sidebar tem "+ Novo", "+ Adicionar repo".

## Helpers disponíveis (`e2e/driver/`)

- `launch.ts` → `launchApp()`: copia dados, lança, retorna `{ app, page, userDataCopy }`.
- `capture.ts` → `screenshot(page, name)`, `captureLogs(app, page)`.
- `nav.ts` → `waitReady(page)`, `goToArea(page, area)`, `openSettings(page)`, `toggleProject(page, name)`.

## Troubleshooting

- **`Electron failed to install correctly`**: o binário do Electron não foi baixado no `node_modules`. Rode `node node_modules/electron/install.js`. (No checkout principal isso normalmente já está resolvido porque você roda `npm run dev` lá.)
- **Tela em branco / `waitReady` estoura**: provavelmente o `WelcomeDialog` apareceu (vault não configurado na cópia) ou o build está velho. Rode `npm run rebuild:native && npm run build` e tente de novo.

## Diagnóstico (Fase 2)

Pra reproduzir um bug: escreva um cenário que execute o passo-a-passo, tire screenshots em pontos-chave, e depois leia `.cm-drive/logs/<timestamp>.log` (console do renderer + stdout/stderr do main) pra ver erros. O `app.db` da cópia pode ser inspecionado read-only com `sqlite3 <userDataCopy>/app.db`.
