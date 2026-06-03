import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, waitReady } from '../driver/nav'

const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await goToArea(page, 'metrics')
  // Janela 7 dias (default). Espera os cards renderizarem.
  await page.getByRole('button', { name: '7 dias' }).click()
  await page.waitForTimeout(1500)
  await screenshot(page, 'metrics-7d')

  // Conteúdo dos KPIs (sanity textual no stdout).
  const values = await page.getByTestId('kpi-value').allInnerTexts()
  const targets = await page.getByTestId('kpi-target').allInnerTexts()
  const deltas7d = await page.getByTestId('kpi-delta').allInnerTexts()
  console.log('[KPI 7d] values=', values, 'targets=', targets, 'deltas=', deltas7d)

  // Rola até o painel Sessões e expande a primeira linha.
  const firstRow = page.getByTestId('session-row').first()
  if (await firstRow.count()) {
    await firstRow.scrollIntoViewIfNeeded()
    await firstRow.click()
    await page.waitForTimeout(300)
    const detailVisible = await page.getByTestId('session-detail').first().isVisible().catch(() => false)
    console.log('[Sessões] detail expandido visível=', detailVisible)
    await screenshot(page, 'metrics-sessions-expanded')
    // ordena por turns
    await page.getByTestId('th-turns').click()
    await page.waitForTimeout(200)
    await screenshot(page, 'metrics-sessions-sorted-turns')
  } else {
    console.log('[Sessões] nenhuma linha na janela 7d')
  }

  // Troca pra "Tudo" → delta deve sumir.
  await page.getByRole('button', { name: 'Tudo' }).click()
  await page.waitForTimeout(1500)
  const deltasAll = await page.getByTestId('kpi-delta').allInnerTexts()
  console.log('[KPI all] deltas (esperado vazio) =', deltasAll, 'count=', deltasAll.length)
  await screenshot(page, 'metrics-all')
} finally {
  stop()
  await app.close()
}
