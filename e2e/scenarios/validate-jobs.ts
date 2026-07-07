import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

// Validação visual da feature Scheduled Jobs: área Jobs, JobDialog (schedule
// builder + preview), e o master-detail. Não spawna sessão real (não clica "Run now").
const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)

async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`[ok] ${name}`)
  } catch (e) {
    console.log(`[skip] ${name}: ${String(e).split('\n')[0]}`)
  }
}

try {
  await waitReady(page)

  // 1) Abrir a área Jobs (botão do IconRail tem title/label "Jobs")
  await page.getByRole('button', { name: 'Jobs' }).click()
  await page.waitForTimeout(600)
  await screenshot(page, 'jobs-01-area')

  // 2) Abrir o dialog de criação (botão "Novo"/"+ Novo"/"Novo job")
  await tryStep('abrir JobDialog', async () => {
    await page.getByRole('button', { name: /novo/i }).first().click()
    await page.waitForTimeout(500)
    await screenshot(page, 'jobs-02-dialog')
  })

  // 3) Schedule builder: selecionar "Diário" e observar o preview das próximas execuções
  await tryStep('schedule diário + preview', async () => {
    await page.getByRole('button', { name: /di[aá]rio|daily/i }).first().click()
    await page.waitForTimeout(900) // debounce 200ms + round-trip IPC previewRuns
    await screenshot(page, 'jobs-03-schedule-daily')
  })

  // 4) Schedule builder: "Semanal" (outro ramo do preview)
  await tryStep('schedule semanal + preview', async () => {
    await page.getByRole('button', { name: /semanal|weekly/i }).first().click()
    await page.waitForTimeout(900)
    await screenshot(page, 'jobs-04-schedule-weekly')
  })

  // 5) Rolar o dialog pra capturar os controles de model/effort/permission (observe-only default)
  await tryStep('screenshot controles de spawn', async () => {
    await screenshot(page, 'jobs-05-spawn-controls')
  })

  console.log(`[log] ${logFile}`)
} finally {
  stop()
  await app.close()
}
