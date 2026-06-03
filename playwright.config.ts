import { defineConfig } from '@playwright/test'

// Suite de regressão E2E do app Electron. Sem browsers do Playwright — os specs
// lançam o app via _electron (ver e2e/specs/_base.ts). Uma instância por vez.
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
})
