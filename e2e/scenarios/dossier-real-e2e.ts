/**
 * Validação REAL da feature Dossiês, ponta a ponta, pela mão do usuário.
 *
 * Diferente de dossier-flow.ts (CM_E2E_STUB_PIPELINE=1), este cenário roda o
 * pipeline de verdade: TavilySourceProvider real (usa a TAVILY_API_KEY que o
 * usuário colou em Configurações, presente na cópia do userData real — ver
 * e2e/driver/launch.ts) + `claude -p` real em Extractor/Verifier/Synthesizer.
 *
 * Gasta créditos reais e leva minutos. Por isso é opt-in via env flag — nunca
 * roda dentro de `npm run e2e`.
 *
 * Rodar: CM_E2E_LIVE=1 npx tsx e2e/scenarios/dossier-real-e2e.ts > /tmp/dossier-real.log 2>&1
 * (nunca pipar pro `| tail`/`| head` — risco de SIGPIPE orfanar o Electron.)
 */
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'
import type { Page } from 'playwright'

if (process.env.CM_E2E_LIVE !== '1') {
  console.log('skip: defina CM_E2E_LIVE=1 pra rodar o cenário real (gasta Tavily + claude -p)')
  process.exit(0)
}

const RUN_TAG = `E2E-REAL ${new Date().toISOString()}`
const TITLE = `${RUN_TAG} — janela de recurso INSS`
const QUESTION =
  'Qual é o prazo legal para recorrer administrativamente de um indeferimento do INSS no Brasil?'

// Detector de falha real (rate-limit, sem crédito, claude -p quebrado): a única
// marca visual estável do estado 'failed' em RunDetailView.tsx é a combinação
// border+bg "color-danger" (a mensagem de erro em si é o err.message cru do
// subprocesso, não dá pra confiar em texto fixo). Substring match no atributo
// class evita escapar colchetes do Tailwind arbitrary value num CSS selector.
// Exigir AMBAS as classes (não só "color-danger" isolado) é essencial: o botão
// "Arquivar dossiê" da lista tem `hover:text-[var(--color-danger)]` sempre
// presente no atributo class (Tailwind não remove classes hover: do DOM), o
// que gerava falso positivo assim que o dossiê aparecia na lista — muito antes
// de qualquer falha real. Só o box de erro tem border-*danger* E bg-*danger*.
const FAILED_BOX =
  '[class*="border-[var(--color-danger)]"][class*="bg-[var(--color-danger)]"]'

async function pollUntil(
  page: Page,
  label: string,
  ready: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<void> {
  const interval = opts.intervalMs ?? 5_000
  const deadline = Date.now() + opts.timeoutMs
  let tick = 0
  while (Date.now() < deadline) {
    if (await page.locator(FAILED_BOX).count()) {
      const msg = await page.locator(FAILED_BOX).first().innerText().catch(() => '?')
      throw new Error(`[${label}] run entrou em failed: ${msg}`)
    }
    if (await ready()) return
    const stage = await page
      .locator('text=/Processando estágio/')
      .first()
      .innerText()
      .catch(() => '')
    console.log(`[poll ${label}] tick ${tick} ${stage}`)
    if (tick % 6 === 0) await screenshot(page, `dossier-poll-${label}-${tick}`)
    tick++
    await page.waitForTimeout(interval)
  }
  throw new Error(`[${label}] timeout após ${opts.timeoutMs}ms`)
}

async function main() {
  const { app, page, userDataCopy } = await launchApp()
  const { stop } = captureLogs(app, page)

  try {
    await waitReady(page)

    // Navega a Dossiês e confirma ausência do banner (mesma prova do spec
    // determinístico, agora contra a run real).
    await page.getByRole('button', { name: 'Dossiês' }).click()
    await page.getByRole('heading', { name: 'Dossiês' }).waitFor({ timeout: 10_000 })
    const banner = page.getByText('Busca web desligada', { exact: false })
    if (await banner.count()) {
      throw new Error(
        'Banner "Busca web desligada" está visível — TAVILY_API_KEY ausente na cópia do userData. Aborte e configure a chave real antes de gastar créditos.',
      )
    }
    await screenshot(page, 'dossier-A-no-banner')

    // Cria o dossiê real.
    await page.getByRole('button', { name: 'Novo dossiê' }).click()
    await page.getByPlaceholder('Título do dossiê').fill(TITLE)
    await page.getByPlaceholder('Pergunta de pesquisa…').fill(QUESTION)
    await page.getByRole('button', { name: 'Criar' }).click()

    const startBtn = page.getByRole('button', { name: /Iniciar pesquisa/ })
    await startBtn.waitFor({ timeout: 10_000 })
    await startBtn.click()

    const gateA = page.getByRole('button', { name: /Aprovar Gate A/ })
    await gateA.waitFor({ timeout: 30_000 })
    await screenshot(page, 'dossier-B-gate-a')
    await gateA.click()

    // Gate A → Gate B: busca web real (Tavily) + N× claude -p de extração.
    const gateB = page.getByRole('button', { name: /Aprovar Gate B/ })
    await pollUntil(page, 'gateB', async () => (await gateB.count()) > 0, {
      timeoutMs: 12 * 60_000,
    })
    await screenshot(page, 'dossier-C-gate-b')
    await gateB.click()

    // Gate B → done: verify + synthesize reais.
    const synthesisHeading = page.getByRole('heading', { name: 'Síntese' })
    const provenanceHeading = page.getByRole('heading', { name: 'Proveniência' })
    await pollUntil(
      page,
      'done',
      async () => (await synthesisHeading.count()) > 0 && (await provenanceHeading.count()) > 0,
      { timeoutMs: 8 * 60_000 },
    )
    await screenshot(page, 'dossier-D-synthesis')

    console.log('OK: run real concluída — encerrando app pra checkpoint do WAL antes de consultar o DB')
  } finally {
    stop()
    await app.close()
  }

  // Só agora — pós app.close() — o WAL foi checkpointed e queryDb (sql.js, sem
  // replay de .db-wal) lê o estado final de verdade.
  const dossierRows = await queryDb<{ id: string }>(
    userDataCopy,
    `SELECT id FROM dossiers WHERE title LIKE 'E2E-REAL %' ORDER BY created_at DESC LIMIT 1`,
  )
  if (!dossierRows[0]) {
    console.error('PROVA FALHOU: nenhum dossier com título E2E-REAL encontrado na cópia do DB')
    process.exit(1)
  }
  const dossierId = dossierRows[0].id

  const runRows = await queryDb<{ id: string; status: string; error: string | null }>(
    userDataCopy,
    `SELECT id, status, error FROM dossier_runs WHERE dossier_id = '${dossierId}' ORDER BY started_at DESC LIMIT 1`,
  )
  const run = runRows[0]
  if (!run) {
    console.error('PROVA FALHOU: dossier criado mas sem dossier_runs associada')
    process.exit(1)
  }

  const [{ c: sourceCount }] = await queryDb<{ c: number }>(
    userDataCopy,
    `SELECT COUNT(*) as c FROM sources WHERE dossier_run_id = '${run.id}'`,
  )
  const [{ c: evidenceCount }] = await queryDb<{ c: number }>(
    userDataCopy,
    `SELECT COUNT(*) as c FROM evidence_records WHERE dossier_run_id = '${run.id}'`,
  )
  // Sinal informativo, não hard-fail: corroborated_by_json/contradicted_by_json só
  // ficam não-nulos quando o Verifier ENCONTRA relação entre claims (ver
  // dossier-store.ts updateEvidenceVerdict — array vazio é persistido como NULL,
  // não como '[]'). Um run real com fontes de baixa autoridade e sem sobreposição
  // de claims pode legitimamente fechar com 0 aqui; não é prova de bug.
  const [{ c: crossVerified }] = await queryDb<{ c: number }>(
    userDataCopy,
    `SELECT COUNT(*) as c FROM evidence_records WHERE dossier_run_id = '${run.id}'
     AND (
       (corroborated_by_json IS NOT NULL AND corroborated_by_json != '[]' AND corroborated_by_json != 'null')
       OR (contradicted_by_json IS NOT NULL AND contradicted_by_json != '[]' AND contradicted_by_json != 'null')
     )`,
  )

  // Prova real de que o ClaudeVerifier (não stub) rodou: 'unverified' é o state
  // gravado na extração (dossier-pipeline.ts runExtract) e SÓ é sobrescrito por
  // updateEvidenceVerdict com um dos states de routeEvidenceState ('contested' |
  // 'primary_accepted' | 'corroborated' | 'single_source') — nunca por 'unverified'
  // de novo. Se sobrar algum evidence_record 'unverified' após a run terminar
  // 'done', o Verifier não rodou de verdade (ou pulou records) — isso sim é bug.
  const [{ c: unverifiedCount }] = await queryDb<{ c: number }>(
    userDataCopy,
    `SELECT COUNT(*) as c FROM evidence_records WHERE dossier_run_id = '${run.id}' AND state = 'unverified'`,
  )

  console.log('=== PROVAS (pós app.close, WAL checkpointed) ===')
  console.log(`status=${run.status}`)
  console.log(`error=${run.error ?? '(nenhum)'}`)
  console.log(`sources=${sourceCount}`)
  console.log(`evidence=${evidenceCount}`)
  console.log(`crossVerified=${crossVerified} (informativo — pode ser 0 legitimamente se as fontes não se sobrepõem)`)
  console.log(`unverified=${unverifiedCount} (deve ser 0 — prova que o Verifier real rodou em todo evidence_record)`)

  const failures: string[] = []
  if (run.status !== 'done') failures.push(`status esperado 'done', obtido '${run.status}'`)
  if (sourceCount <= 0) failures.push('sources deveria ser > 0')
  if (evidenceCount <= 0) failures.push('evidence_records deveria ser > 0')
  if (unverifiedCount > 0)
    failures.push(
      `${unverifiedCount} evidence_record(s) seguem 'unverified' com a run em 'done' — o Verifier real não escreveu veredito em todos`,
    )

  if (failures.length) {
    console.error('PROVA FALHOU:')
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }

  console.log('OK: prova de ponta a ponta fechada — pesquisa real via Tavily + extração e verificação reais via claude -p')
}

main().catch((err) => {
  console.error('FALHA no cenário real:', err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
