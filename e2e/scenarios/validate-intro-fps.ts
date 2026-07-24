import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

/**
 * FPS em regime permanente de cada variante.
 *
 * Medir logo após trocar de cena mede compilação de shader, não desempenho:
 * o contador precisa de alguns segundos rodando para dizer alguma coisa.
 */
const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)

const SCENES = ['lights-out', 'pit-wall', 'harness', 'slipstream']
const DWELL_MS = 5000

try {
  await waitReady(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await page.keyboard.press('Control+Shift+G')
  await page.waitForTimeout(1000)

  for (const [i, name] of SCENES.entries()) {
    await page.keyboard.press(String(i + 1))
    await page.waitForTimeout(DWELL_MS)
    // O contador é o último span do rodapé direito da galeria.
    const fps = await page.locator('span', { hasText: /^\d+ fps$/ }).first().innerText()
    console.log(`[fps] ${name.padEnd(12)} ${fps}`)
    await screenshot(page, `fps-${name}`)
  }
} finally {
  stop()
  await app.close()
}
