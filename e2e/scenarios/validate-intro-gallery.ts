import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

/**
 * Abre a galeria e fotografa cada variante em dois momentos do arco. Serve pra
 * provar que as quatro cenas realmente montam e desenham — typecheck não diz
 * nada sobre WebGL.
 */
const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)

const SCENES = ['1-lights-out', '2-pit-wall', '3-harness', '4-slipstream']

try {
  await waitReady(page)
  // Sai da intro de boot antes de abrir a galeria.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  await page.keyboard.press('Control+Shift+G')
  await page.waitForTimeout(800)

  const gallery = await page.locator('div.fixed.inset-0.z-\\[200\\]').count()
  console.log(`[check] galeria abriu? ${gallery === 1 ? 'SIM' : 'NÃO'}`)

  for (const [i, name] of SCENES.entries()) {
    await page.keyboard.press(String(i + 1))
    // Meio do arco: geometria no auge.
    await page.waitForTimeout(700)
    await screenshot(page, `gal-${name}-meio`)
    // Fim do arco: precisa ter centro limpo pro wordmark.
    await page.waitForTimeout(800)
    await screenshot(page, `gal-${name}-fim`)
  }
} finally {
  stop()
  await app.close()
}
