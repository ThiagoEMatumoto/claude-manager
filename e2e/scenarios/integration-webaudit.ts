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
// cliente/caso → este cenário NÃO despeja o relatório. Só imprime status, length, se
// contém "LCP" e o VALOR numérico do LCP (número não é sensível). Ao final, o operador
// deve limpar os screenshots do cwd do job (repoId:null → ~/ClaudeManager/scratch):
// `rm -rf ~/ClaudeManager/scratch/.playwright-mcp`.

// Modelo do job: sonnet (rápido e segue o playbook direto). O opus default é lento e
// tende a sobre-elaborar (spawn de sub-agente de QA que NÃO herda as browser tools) —
// override via WEBAUDIT_MODEL. O wiring (allowlist/env/MCP) é model-independent.
const MODEL = process.env.WEBAUDIT_MODEL ?? 'sonnet'
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
    async ({ url, prompt, model }) => {
      const job = await (window as any).api.scheduledJobs.create({
        name: 'webaudit-staging',
        kind: 'web-audit',
        repoId: null,
        prompt,
        targetUrl: url,
        model,
        schedule: { type: 'interval', hours: 24 },
        permissionMode: 'default',
      })
      return job.id as string
    },
    { url: TARGET_URL, prompt: PROMPT, model: MODEL },
  )
  console.log('JOB_ID', jobId, 'TARGET', TARGET_URL, 'MODEL', MODEL)

  const t0 = Date.now()
  await page.evaluate((id) => (window as any).api.scheduledJobs.runNow(id), jobId)

  // Poll generoso: login Firebase + navegação + captura de métricas leva minutos.
  // Só fecha o app DEPOIS do status terminal (senão mata o child no meio do browser).
  // 320 * 3s = 960s de teto (< WEB_AUDIT_TIMEOUT_MS de 20min do runner; sonnet finaliza
  // bem antes). O runner marca 'failed' no timeout, então o poll nunca fica preso.
  let row: Record<string, unknown> | undefined
  for (let i = 0; i < 320; i++) {
    if (i === 3 || i === 60 || i === 150 || i === 300) snapClaude(String(i))
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
  // Evidência POSITIVA de página autenticada (sem despejar conteúdo sensível): o VALOR
  // numérico do LCP do bloco json de métricas (número não é sensível) + se o relatório
  // referencia a rota autenticada /app. lcp não-null ⇒ mediu na página logada.
  const lcpMatch = apiReport.match(/"lcp"\s*:\s*(\d+)/)
  const authRoute = /\/app\//.test(apiReport) || /casos/i.test(apiReport)
  console.log('ELAPSED_TO_TERMINAL_S', elapsedS)
  console.log(
    'FINAL_ROW',
    JSON.stringify({
      status: row?.status,
      captureQuality: row?.captureQuality,
      tokens: row?.tokens,
      error: row?.error,
      apiReportLen: apiReport.length,
      hasLCP: /lcp/i.test(apiReport),
      lcpValue: lcpMatch ? Number(lcpMatch[1]) : null,
      referencesAuthRoute: authRoute,
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
