import { launchApp } from '../driver/launch'
import { screenshot, captureLogs } from '../driver/capture'
import { waitReady, goToArea, openSettings } from '../driver/nav'

async function main() {
  const { app, page } = await launchApp()
  const { logFile, stop } = captureLogs(app, page)
  try {
    await waitReady(page)
    console.log('boot: waitReady OK')

    // --- Área de projetos ---
    await goToArea(page, 'projects')
    await page.waitForTimeout(500)
    await screenshot(page, '01-projects-sidebar')

    // Botão "Atualizar todos" — na sidebar é icon-only (RefreshCw) identificado por title.
    const pullAllBtn = page.getByTitle('git pull --ff-only em todos os repos (pula sujos/divergentes)')
    const pullAllCount = await pullAllBtn.count()
    console.log(`ui: botão "Atualizar todos" (pull-all por title) encontrado = ${pullAllCount > 0} (count=${pullAllCount})`)

    // Banner de faltantes (só aparece se há repos registrados ausentes no disco).
    const cloneMissingBtn = page.getByRole('button', { name: /Clonar faltantes|Clonando/ })
    const cloneMissingVisible = (await cloneMissingBtn.count()) > 0
    console.log(`ui: banner "Clonar faltantes" presente = ${cloneMissingVisible}`)

    // --- Settings → Geral → Projetos ---
    await openSettings(page)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Geral', exact: true }).first().click().catch(async () => {
      await page.getByText('Geral', { exact: true }).first().click()
    })
    await page.waitForTimeout(300)

    const projetosSection = page.getByText('Projetos', { exact: true })
    await projetosSection.last().scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(200)

    const cloneToggle = page.getByText('Clonar repos faltantes automaticamente', { exact: true })
    const pullToggle = page.getByText('Atualizar repos automaticamente', { exact: true })
    const hasClone = (await cloneToggle.count()) > 0
    const hasPull = (await pullToggle.count()) > 0
    console.log(`settings: toggle "Clonar repos faltantes automaticamente" = ${hasClone}`)
    console.log(`settings: toggle "Atualizar repos automaticamente" = ${hasPull}`)

    // Campo de intervalo só renderiza quando auto-pull está ligado; liga pra revelar (cópia, não-destrutivo).
    let hasInterval = (await page.getByText('Intervalo (minutos)', { exact: true }).count()) > 0
    console.log(`settings: campo "Intervalo (minutos)" visível antes de togglar = ${hasInterval}`)
    if (!hasInterval && hasPull) {
      const pullCheckbox = pullToggle.locator('xpath=ancestor::label').locator('input[type="checkbox"]')
      await pullCheckbox.click().catch(() => {})
      await page.waitForTimeout(300)
      hasInterval = (await page.getByText('Intervalo (minutos)', { exact: true }).count()) > 0
      console.log(`settings: campo "Intervalo (minutos)" após ligar auto-pull = ${hasInterval}`)
    }

    await page.waitForTimeout(200)
    await screenshot(page, '02-settings-projetos')

    console.log(`log file: ${logFile}`)
    console.log('DONE')
  } finally {
    stop()
    await app.close()
  }
}

main().catch((e) => {
  console.error('SCENARIO ERROR:', e)
  process.exit(1)
})
