import { execSync } from 'node:child_process'
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

const MODE = process.env.JOB_MODE ?? 'plan'

// Loop end-to-end da feature Scheduled Jobs contra o runner HEADLESS real:
// cria job trivial -> runNow -> aguarda job_runs finalizar -> inspeciona o report.
//
// Poll via a API do renderer (scheduledJobs.listRuns), NÃO via queryDb/sql.js: o
// app abre o SQLite em journal_mode=WAL e os updates da run vivem no app.db-wal até
// o checkpoint do close — sql.js lê só o app.db, então não veria a finalização com
// o app ainda vivo. A API bate no better-sqlite3 vivo do processo main (enxerga o
// -wal), refletindo a finalização async do runner em tempo real.
const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)

function snapClaude(tag: string): void {
  try {
    const out = execSync("ps -eo pid,etimes,args | grep '[c]laude -p' || true", {
      encoding: 'utf8',
    })
    console.log(`PS_${tag}`, out.trim() || '(none)')
  } catch {
    /* ignore */
  }
}

try {
  await waitReady(page)

  const jobId = await page.evaluate(async (mode) => {
    const job = await (window as any).api.scheduledJobs.create({
      name: 'smoke-run',
      repoId: null,
      prompt: 'Responda apenas com a palavra OK.',
      schedule: { type: 'interval', hours: 24 },
      permissionMode: mode,
    })
    return job.id as string
  }, MODE)
  console.log('JOB_ID', jobId, 'MODE', MODE)

  await page.evaluate((id) => (window as any).api.scheduledJobs.runNow(id), jobId)

  let row: Record<string, unknown> | undefined
  for (let i = 0; i < 130; i++) {
    if (i === 3 || i === 20 || i === 60) snapClaude(String(i))
    const runs = (await page.evaluate(
      (jid) => (window as any).api.scheduledJobs.listRuns({ jobId: jid, limit: 1 }),
      jobId,
    )) as Record<string, unknown>[]
    row = runs[0]
    console.log(i * 2 + 's', row?.status)
    if (row && ['success', 'failed', 'interrupted'].includes(String(row.status))) break
    await page.waitForTimeout(2000)
  }

  console.log('FINAL_ROW', JSON.stringify(row))
  await screenshot(page, 'integration-run')
  console.log('LOG_FILE', logFile)
} finally {
  stop()
  await app.close()
}
