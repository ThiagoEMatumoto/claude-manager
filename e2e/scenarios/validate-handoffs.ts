import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
const errors: string[] = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

try {
  await waitReady(page)

  // Navega pra área de Handoffs (botão do IconRail com title="Handoffs").
  await page.getByRole('button', { name: 'Handoffs' }).click()
  await page.waitForTimeout(800)
  await screenshot(page, 'handoffs-panel')

  // Volta pra Projetos pra capturar a SessionStrip (barra de sessões).
  await page.getByRole('button', { name: 'Projetos' }).click()
  await page.waitForTimeout(600)
  await screenshot(page, 'projects-sessionstrip')

  console.log('SCENARIO_ERRORS_JSON=' + JSON.stringify(errors))
  console.log('OK — handoffs validado.')
} finally {
  stop()
  await app.close()
}
