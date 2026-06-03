import { captureLogs, screenshot } from '../driver/capture'
import { listTables, queryDb } from '../driver/inspect'
import { launchApp } from '../driver/launch'
import { goToArea, waitReady } from '../driver/nav'

// Exemplo de fluxo de DIAGNÓSTICO (Fase 2): reproduz um passo-a-passo, tira
// screenshots em pontos-chave, e correlaciona com log (renderer+main) e estado (DB).
// Copie e adapte os passos pra reproduzir um bug específico.
async function main() {
  const { app, page, userDataCopy } = await launchApp()
  const { logFile, stop } = captureLogs(app, page)
  try {
    await waitReady(page)

    // Probe: prova que a captura pega console do renderer (deve aparecer no log).
    await page.evaluate(() => console.log('cm-drive: probe de captura'))

    // --- passos do repro (adapte) ---
    await goToArea(page, 'projects')
    await page.waitForTimeout(300)
    await screenshot(page, 'diag-projects')

    // --- estado via DB (read-only na cópia) ---
    const tables = await listTables(userDataCopy)
    const counts: string[] = []
    for (const t of tables) {
      const [row] = await queryDb<{ n: number }>(userDataCopy, `SELECT count(*) AS n FROM "${t}"`)
      counts.push(`${t}=${row?.n ?? 0}`)
    }

    console.log('Diagnóstico:')
    console.log(`  tabelas: ${counts.join(', ')}`)
    console.log(`  screenshot: .cm-drive/screenshots/diag-projects.png`)
    console.log(`  log:        ${logFile}`)
  } finally {
    stop()
    await app.close()
  }
}

main().catch((err) => {
  console.error('FALHA no diagnóstico:', err)
  process.exit(1)
})
