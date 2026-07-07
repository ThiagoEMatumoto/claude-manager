import { execSync } from 'node:child_process'
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

// Integração REAL de um job kind:'web-audit' (Fase 1). Molde do integration-critique,
// mas dirige um BROWSER autenticado: cria um job web-audit apontando pro legal-ui
// staging, dispara runNow e confirma que a run finaliza 'success' com um relatório
// que contém métricas reais (LCP) da página autenticada.
//
// AUTH SEGURA: launchApp copia o app.db REAL do usuário, que contém as custom_env_vars
// (LEGAL_UI_STAGING_USERNAME/PASSWORD). O app injeta essas vars no processo do job via
// spawnEnv — o teste NUNCA toca a senha. O playbook (composeJobKickoff) instrui a
// sessão a ler as creds via printenv e logar, sem ecoá-las.
//
// SEGURANÇA DO OUTPUT: o report_text da página autenticada pode conter dados de
// cliente/caso → este cenário NÃO despeja o relatório. Só imprime status, length e se
// contém "LCP". Ao final, o operador deve rodar `rm -rf .playwright-mcp` (screenshots).

const TARGET_URL = process.env.WEBAUDIT_URL ?? 'https://app.legalstaging.lexter.ai'
const PROMPT =
  'Audite o desempenho e a usabilidade da página inicial do legal-ui. Faça login se ' +
  'necessário e siga o playbook de auditoria web abaixo.'

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
    async ({ url, prompt }) => {
      const job = await (window as any).api.scheduledJobs.create({
        name: 'webaudit-staging',
        kind: 'web-audit',
        repoId: null,
        prompt,
        targetUrl: url,
        schedule: { type: 'interval', hours: 24 },
        permissionMode: 'default',
      })
      return job.id as string
    },
    { url: TARGET_URL, prompt: PROMPT },
  )
  console.log('JOB_ID', jobId, 'TARGET', TARGET_URL)

  const t0 = Date.now()
  await page.evaluate((id) => (window as any).api.scheduledJobs.runNow(id), jobId)

  // Poll generoso: login Firebase + navegação + captura de métricas leva minutos.
  // Só fecha o app DEPOIS do status terminal (senão mata o child no meio do browser).
  // 200 * 3s = 600s de teto (alinhado ao JOB_TIMEOUT_MS de 10min do runner).
  let row: Record<string, unknown> | undefined
  for (let i = 0; i < 200; i++) {
    if (i === 3 || i === 50 || i === 120 || i === 190) snapClaude(String(i))
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
  // NÃO despeja o report (pode conter dados de cliente): só status/len/tem-LCP.
  console.log(
    'FINAL_ROW',
    JSON.stringify({
      status: row?.status,
      captureQuality: row?.captureQuality,
      tokens: row?.tokens,
      error: row?.error,
      apiReportLen: apiReport.length,
      hasLCP: /lcp/i.test(apiReport),
    }),
  )
  await screenshot(page, 'integration-webaudit')
  console.log('LOG_FILE', logFile)
} finally {
  stop()
  await app.close()
}

// Pós-close: o WAL foi materializado no app.db da cópia → queryDb enxerga a run
// finalizada. NÃO seleciona report_text (dados sensíveis) — só length e se tem "LCP".
const dbRow = await queryDb<{ status: string; len: number; capture_quality: string | null }>(
  userDataCopy,
  `SELECT status, length(report_text) AS len, capture_quality
   FROM job_runs WHERE job_id='${jobId}' ORDER BY created_at DESC LIMIT 1`,
)
const hasLcp = await queryDb<{ has_lcp: number }>(
  userDataCopy,
  `SELECT (report_text LIKE '%LCP%' OR report_text LIKE '%lcp%') AS has_lcp
   FROM job_runs WHERE job_id='${jobId}' ORDER BY created_at DESC LIMIT 1`,
)
console.log(
  'DB_FINAL_ROW',
  JSON.stringify({ ...dbRow[0], hasLCP: hasLcp[0]?.has_lcp === 1 }),
)
