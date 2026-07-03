// Cenário ad-hoc: forçar o estado "repo faltando no disco" para validar o badge.
// Abordagem não-destrutiva: copiamos o userData real para um dir temporário e
// mutamos SÓ a cópia (app.db) via sql.js — nunca tocamos pastas reais nem o DB real.
// Depois lançamos o Electron apontando --user-data-dir para a cópia mutada.
import { _electron as electron } from 'playwright'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { REPO_ROOT, resolveRealUserData } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, waitReady } from '../driver/nav'

const require = createRequire(import.meta.url)
const MAIN_ENTRY = join(REPO_ROOT, 'out/main/index.js')
const NONEXISTENT = '/tmp/nonexistent-repo-xyz-cm-drive'

async function main() {
  const real = resolveRealUserData()
  const copy = mkdtempSync(join(tmpdir(), 'cm-drive-missing-'))
  if (existsSync(real)) cpSync(real, copy, { recursive: true })

  const dbPath = join(copy, 'app.db')
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  const db = new SQL.Database(readFileSync(dbPath))

  // Escolhe um repo e descobre o projeto dono, para saber qual expandir na UI.
  const [sel] = db.exec(`
    SELECT r.id AS repo_id, r.label AS repo_label, p.name AS project_name
    FROM repos r JOIN projects p ON p.id = r.project_id
    ORDER BY r.position LIMIT 1
  `)
  if (!sel || sel.values.length === 0) throw new Error('Nenhum repo encontrado no DB copiado.')
  const cols = sel.columns
  const row = sel.values[0]
  const pick = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as {
    repo_id: string
    repo_label: string
    project_name: string
  }
  console.log('Repo alvo:', pick.repo_label, '| projeto:', pick.project_name)

  // Muta o path para um dir garantidamente inexistente → existsOnDisk=false.
  db.run('UPDATE repos SET path = ? WHERE id = ?', [NONEXISTENT, pick.repo_id])
  writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()

  const app = await electron.launch({
    args: [MAIN_ENTRY, '--no-sandbox', `--user-data-dir=${copy}`],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const { stop } = captureLogs(app, page)
  try {
    await waitReady(page)
    await goToArea(page, 'projects')
    await page.getByText(pick.project_name, { exact: true }).first().click()
    await page.getByText('faltando no disco', { exact: false }).first().waitFor({ timeout: 10_000 })
    const shot = await screenshot(page, 'missing-repo')
    console.log('OK — badge "faltando no disco" renderizado. Screenshot:', shot)
    console.log('userData (cópia mutada):', copy)
  } finally {
    stop()
    await app.close()
  }
}

main().catch((e) => {
  console.error('FALHA no cenário missing-repo:', e)
  process.exit(1)
})
