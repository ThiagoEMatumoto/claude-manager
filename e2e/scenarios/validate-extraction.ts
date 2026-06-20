/**
 * Validação VISUAL do fluxo de extração (Meeting Intelligence).
 *
 * Fluxo: Reuniões → Nova reunião → Iniciar (fake sidecar gera transcript, ~6.4s,
 * status vira `ready`) → Enriquecer (claude -p REAL, 15-60s) → revisar cards →
 * marcar 1 item + vínculo → Materializar.
 *
 * O claude -p é REAL: pode falhar (claude ausente, parse, timeout). O cenário
 * captura o que conseguir, roda os SELECTs mesmo assim, e nunca inventa dados.
 *
 * Rodar: npx tsx e2e/scenarios/validate-extraction.ts
 */
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const { app, page, userDataCopy } = await launchApp()
const { stop, logFile } = captureLogs(app, page)

let enriched = false
let materialized = false

try {
  await waitReady(page)

  // Entrar na área Reuniões (IconRail title) e criar uma reunião nova (nasce idle).
  await page.getByTitle('Reuniões', { exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByTitle('Nova reunião', { exact: true }).click()
  await page.waitForTimeout(400)

  // Iniciar captura → fake sidecar emite 8 segmentos (~6.4s) → done → status `ready`.
  await page.getByRole('button', { name: /iniciar/i }).click()
  await page.waitForTimeout(8000) // ≥7s garante o `done` do sidecar
  await screenshot(page, 'extract-00-transcript')

  // Enriquecer só habilita em status ∈ {ready, extracted}. Espera o botão ficar
  // habilitado (sidecar pode atrasar) antes de clicar.
  const enrichBtn = page.getByRole('button', { name: 'Enriquecer', exact: true })
  await enrichBtn.waitFor({ state: 'visible', timeout: 15_000 })
  // Garante que está habilitado (o disabled some quando status vira ready).
  await page
    .locator('button:has-text("Enriquecer"):not([disabled])')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await enrichBtn.click()

  // claude -p REAL: espera a review aparecer (data-meeting-id é o root da
  // ExtractionReview) OU a barra de erro "Falha ao enriquecer". Timeout largo.
  const reviewRoot = page.locator('[data-meeting-id]')
  const errBanner = page.getByText(/Falha ao enriquecer/i)
  try {
    await Promise.race([
      reviewRoot.waitFor({ state: 'visible', timeout: 90_000 }),
      errBanner.waitFor({ state: 'visible', timeout: 90_000 }),
    ])
  } catch {
    // segue pro screenshot/SELECT mesmo se nenhum apareceu no prazo
  }
  await page.waitForTimeout(500)
  await screenshot(page, 'extract-01-review')

  enriched = await reviewRoot.isVisible().catch(() => false)
  const hasError = await errBanner.isVisible().catch(() => false)

  if (enriched && !hasError) {
    // Materializar 1 item: marca o 1º checkbox "incluir" disponível e, se houver
    // options reais no select Vínculo, escolhe a primeira; depois clica Materializar.
    const includeChecks = page.getByRole('checkbox')
    const count = await includeChecks.count()
    if (count > 0) {
      const first = includeChecks.first()
      if (!(await first.isChecked())) await first.check()

      // Escolhe um vínculo se existir alguma option de objetivo/feature.
      const linkSelect = page.getByRole('combobox', { name: 'Vínculo' }).first()
      if (await linkSelect.count()) {
        const optionValues = await linkSelect
          .locator('option[value^="objective:"], option[value^="feature:"]')
          .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
        if (optionValues.length > 0) {
          await linkSelect.selectOption(optionValues[0])
        }
      }

      const materializeBtn = page.getByRole('button', { name: /Materializar/ })
      await materializeBtn.click()
      await page.waitForTimeout(1500)
      materialized = true
    }
  }
  await screenshot(page, 'extract-02-after-materialize')
} finally {
  stop()
  await app.close()
}

console.log('LOG_FILE:', logFile)
console.log('ENRICHED:', enriched, 'MATERIALIZED:', materialized)

// queryDb roda APÓS app.close() (checkpoint do WAL). Schema confirmado na
// migration 022/023: type, text, grounded(0/1), materialized_task_id.
const ext = await queryDb(
  userDataCopy,
  'SELECT type, text, grounded, materialized_task_id FROM meeting_extractions',
)
console.log('EXTRACTIONS_COUNT:', ext.length)
console.log('EXTRACTIONS:', JSON.stringify(ext))

const tasks = await queryDb(
  userDataCopy,
  'SELECT title, tags FROM tasks ORDER BY created_at DESC LIMIT 6',
)
console.log('RECENT_TASKS:', JSON.stringify(tasks))
