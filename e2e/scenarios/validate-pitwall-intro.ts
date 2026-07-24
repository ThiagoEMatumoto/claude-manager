import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

/**
 * Captura o arco da intro PITWALL no boot.
 *
 * A intro pula com pointerdown/keydown/wheel — o Playwright não emite nenhum
 * desses ao tirar screenshot, então dá pra fotografar o arco inteiro sem
 * interferir nele. Os frames saem em .cm-drive/screenshots/intro-NNNN.png.
 */
const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)

try {
  // A trava de userData em electron/main/index.ts NÃO pode vencer o
  // --user-data-dir do harness — se vencer, dirigir o app passa a mexer no
  // banco real do usuário em vez da cópia.
  const used = await app.evaluate(({ app }) => app.getPath('userData'))
  console.log(`[check] userData em uso: ${used}`)
  console.log(`[check] cópia esperada:  ${userDataCopy}`)
  console.log(`[check] usa a cópia? ${used === userDataCopy ? 'SIM' : 'NÃO — DADOS REAIS EM RISCO'}`)

  // Nada de waitReady antes: o ponto é justamente pegar os primeiros frames,
  // que acontecem enquanto o app ainda está montando por trás do overlay.
  const start = Date.now()
  for (let i = 0; i < 12; i++) {
    await screenshot(page, `intro-${String(Date.now() - start).padStart(4, '0')}ms`)
    await page.waitForTimeout(250)
  }

  await waitReady(page)
  await page.waitForTimeout(1200)
  await screenshot(page, 'intro-99-handoff')

  // O overlay tem que ter saído do DOM — se sobrar, o app fica inusável.
  const overlays = await page.locator('div.fixed.inset-0.z-\\[100\\]').count()
  console.log(`[check] overlays da intro remanescentes: ${overlays} (esperado 0)`)

  // E o canvas WebGL não pode continuar vivo queimando GPU atrás do app.
  const canvases = await page.locator('canvas').count()
  console.log(`[check] canvas no DOM após a intro: ${canvases}`)
} finally {
  stop()
  await app.close()
}
