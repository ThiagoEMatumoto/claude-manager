// Entry wrapper: registra o loader tsx (via API oficial) e DEPOIS o stub de
// electron (último register tem precedência), então importa o cenário .ts.
// Roda: node e2e/scenarios/sync-e2e-real.entry.mjs
import { register as tsxRegister } from 'tsx/esm/api'
import { register } from 'node:module'

tsxRegister()
register('./_electron-stub.mjs', import.meta.url)

await import('./sync-e2e-real.ts')
