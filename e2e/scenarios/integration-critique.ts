import { execSync } from 'node:child_process'
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

// Default do produto é 'default' (observe-only via read-only lockdown do runner;
// 'plan' desviaria pro ExitPlanMode indisponível em headless). Override via JOB_MODE.
const MODE = process.env.JOB_MODE ?? 'default'

const PROMPT =
  'Escreva uma análise técnica detalhada, com pelo menos 800 palavras, sobre riscos de ' +
  'segurança em aplicações Electron que spawnam processos filhos (claude CLI, PTY, execFile): ' +
  'liste ao menos 10 riscos concretos com uma recomendação de mitigação para cada, em markdown ' +
  'com seções.'

// Variante do integration-run.ts para um prompt que gera output LONGO: valida que a
// captura do relatório (Fase 2) aguenta um relatório real (milhares de chars) sem estourar
// o maxBuffer de 16MB (electron/main/services/claude-cli.ts) nem o timeout do runner.
//
// Detecção do status terminal via API scheduledJobs.listRuns (NÃO queryDb): o app abre o
// SQLite em journal_mode=WAL e os updates da run vivem no app.db-wal até o checkpoint do
// close — sql.js lê só o app.db, então não veria a finalização com o app vivo. As métricas
// finais (length/capture_quality/substr) são lidas via queryDb DEPOIS do app.close(), quando
// o WAL já foi materializado no app.db. A API ainda expõe reportText.length ao vivo, usado
// como sinal imediato durante o poll.
const { app, page, userDataCopy } = await launchApp()
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

let jobId = ''
try {
  await waitReady(page)

  jobId = await page.evaluate(
    async ({ mode, prompt }) => {
      const job = await (window as any).api.scheduledJobs.create({
        name: 'critique-long',
        repoId: null,
        prompt,
        schedule: { type: 'interval', hours: 24 },
        permissionMode: mode,
      })
      return job.id as string
    },
    { mode: MODE, prompt: PROMPT },
  )
  console.log('JOB_ID', jobId, 'MODE', MODE)

  const t0 = Date.now()
  await page.evaluate((id) => (window as any).api.scheduledJobs.runNow(id), jobId)

  // Poll bem generoso: a crítica longa (800+ palavras, default mode) leva vários
  // minutos — muito mais que o "OK". Só fecha o app DEPOIS do status terminal, senão o
  // app.close() mata o child no meio da geração e a run fica presa em 'running'.
  // 150 * 3s = 450s de teto.
  let row: Record<string, unknown> | undefined
  for (let i = 0; i < 150; i++) {
    if (i === 3 || i === 50 || i === 100 || i === 140) snapClaude(String(i))
    const runs = (await page.evaluate(
      (jid) => (window as any).api.scheduledJobs.listRuns({ jobId: jid, limit: 1 }),
      jobId,
    )) as Record<string, unknown>[]
    row = runs[0]
    const rt = (row?.reportText as string | null) ?? ''
    console.log(i * 3 + 's', row?.status, 'reportLen', rt.length)
    if (row && ['success', 'failed', 'interrupted'].includes(String(row.status))) break
    await page.waitForTimeout(3000)
  }
  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1)

  const apiReport = (row?.reportText as string | null) ?? ''
  console.log('ELAPSED_TO_TERMINAL_S', elapsedS)
  console.log(
    'FINAL_ROW',
    JSON.stringify({
      status: row?.status,
      captureQuality: row?.captureQuality,
      tokens: row?.tokens,
      error: row?.error,
      apiReportLen: apiReport.length,
    }),
  )
  console.log('API_REPORT_HEAD', JSON.stringify(apiReport.slice(0, 300)))
  await screenshot(page, 'integration-critique')
  console.log('LOG_FILE', logFile)
} finally {
  stop()
  await app.close()
}

// Pós-close: o WAL já foi materializado no app.db da cópia, então o queryDb enxerga a run
// finalizada. Leitura autoritativa via as colunas exatas pedidas.
const dbRow = await queryDb(
  userDataCopy,
  `SELECT status, length(report_text) AS len, capture_quality, tokens, error
   FROM job_runs WHERE job_id='${jobId}' ORDER BY created_at DESC LIMIT 1`,
)
console.log('DB_ROW', JSON.stringify(dbRow[0]))

const dbHead = await queryDb<{ head: string | null }>(
  userDataCopy,
  `SELECT substr(report_text,1,300) AS head
   FROM job_runs WHERE job_id='${jobId}' ORDER BY created_at DESC LIMIT 1`,
)
console.log('DB_REPORT_HEAD', JSON.stringify(dbHead[0]?.head))
