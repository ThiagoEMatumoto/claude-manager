import { captureLogs, screenshot } from '../driver/capture'
import { launchApp } from '../driver/launch'
import { goToArea, waitReady } from '../driver/nav'

// Cenário-smoke da Fase 1: abre o app contra a cópia dos dados, navega até a área
// de Projetos e tira screenshots pra eu (Claude) analisar visualmente.
async function main() {
  const { app, page, userDataCopy } = await launchApp()
  const { logFile, stop } = captureLogs(app, page)
  try {
    await waitReady(page)
    const shot1 = await screenshot(page, '01-initial')
    await goToArea(page, 'projects')
    await page.waitForTimeout(500)
    const shot2 = await screenshot(page, '02-projects')

    console.log('OK — app dirigido com sucesso.')
    console.log(`  userData (cópia): ${userDataCopy}`)
    console.log(`  screenshot 1:     ${shot1}`)
    console.log(`  screenshot 2:     ${shot2}`)
    console.log(`  log:              ${logFile}`)
  } finally {
    stop()
    await app.close()
  }
}

main().catch((err) => {
  console.error('FALHA no cenário:', err)
  process.exit(1)
})
