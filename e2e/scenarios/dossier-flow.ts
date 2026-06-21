import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

// Exercita a feature Research Dossier de ponta a ponta (pipeline stub):
// nav → criar dossiê → iniciar → Gate A → Gate B → síntese + proveniência.
const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)

try {
  await waitReady(page)
  await screenshot(page, 'dossier-01-initial')

  // Navega pra área Dossiês via IconRail.
  await page.getByRole('button', { name: 'Dossiês' }).click()
  await page.getByRole('heading', { name: 'Dossiês' }).waitFor({ timeout: 10_000 })
  await screenshot(page, 'dossier-02-empty')

  // Cria um dossiê.
  await page.getByRole('button', { name: 'Novo dossiê' }).click()
  await page.getByPlaceholder('Título do dossiê').fill('Abandono pós-protocolização BPC/LOAS')
  await page
    .getByPlaceholder('Pergunta de pesquisa…')
    .fill('Como advogados previdenciários reduzem a desistência na fase pós-protocolo?')
  await screenshot(page, 'dossier-03-form')
  await page.getByRole('button', { name: 'Criar' }).click()

  // Inicia a pesquisa (pipeline stub) → Gate A.
  const startBtn = page.getByRole('button', { name: /Iniciar pesquisa/ })
  await startBtn.waitFor({ timeout: 10_000 })
  await screenshot(page, 'dossier-04-created')
  await startBtn.click()

  const gateA = page.getByRole('button', { name: /Aprovar Gate A/ })
  await gateA.waitFor({ timeout: 10_000 })
  await screenshot(page, 'dossier-05-gate-a')
  await gateA.click()

  // Gate A → busca Tavily real + fetch Jina de várias URLs: pode levar dezenas de s.
  const gateB = page.getByRole('button', { name: /Aprovar Gate B/ })
  await gateB.waitFor({ timeout: 90_000 })
  await screenshot(page, 'dossier-06-gate-b')
  await gateB.click()

  // Run concluída: síntese graduada + apêndice de proveniência.
  await page.getByRole('heading', { name: 'Síntese' }).waitFor({ timeout: 30_000 })
  await page.getByRole('heading', { name: 'Proveniência' }).waitFor({ timeout: 30_000 })
  await screenshot(page, 'dossier-07-done')

  console.log('OK: fluxo completo do dossiê executado')
} catch (err) {
  await screenshot(page, 'dossier-99-error')
  console.error('FALHA no cenário:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  stop()
  await app.close()
}
