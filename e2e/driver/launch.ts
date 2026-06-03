import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { cpSync, existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '../..')
const MAIN_ENTRY = join(REPO_ROOT, 'out/main/index.js')

// O dir de userData real é o que contém o app.db — db.ts deriva o path do banco
// de app.getPath('userData'), então o dir com app.db É a instalação real.
// Override explícito via CM_REAL_USERDATA quando preciso apontar outro perfil.
export function resolveRealUserData(): string {
  const override = process.env.CM_REAL_USERDATA
  if (override) return override
  const configDir = join(homedir(), '.config')
  if (existsSync(configDir)) {
    for (const name of readdirSync(configDir)) {
      const candidate = join(configDir, name)
      if (existsSync(join(candidate, 'app.db'))) return candidate
    }
  }
  return join(configDir, 'claude-manager')
}

export interface LaunchResult {
  app: ElectronApplication
  page: Page
  userDataCopy: string
}

// Lança o app BUILDADO (out/main/index.js) contra uma CÓPIA do userData real.
// --user-data-dir redireciona o SQLite e todo o app.getPath('userData') pra cópia,
// então nada que eu fizer toca os dados reais.
export async function launchApp(): Promise<LaunchResult> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Build não encontrado em ${MAIN_ENTRY}.\nRode antes: npm run rebuild:native && npm run build`,
    )
  }
  const real = resolveRealUserData()
  const copy = mkdtempSync(join(tmpdir(), 'cm-drive-userdata-'))
  if (existsSync(real)) {
    cpSync(real, copy, { recursive: true })
  }
  const app = await electron.launch({
    args: [MAIN_ENTRY, '--no-sandbox', `--user-data-dir=${copy}`],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataCopy: copy }
}
