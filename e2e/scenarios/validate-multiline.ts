import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, toggleProject, waitReady } from '../driver/nav'

const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)

try {
  await waitReady(page)
  await goToArea(page, 'projects')
  await page.waitForTimeout(400)
  await screenshot(page, 'multiline-projects')

  // Expande o projeto "Pessoal" (tem o repo claude-manager) pra revelar a linha
  // "Nova sessão · ...". Fallback: tenta os outros projetos conhecidos.
  for (const proj of ['Pessoal', 'Diligencia', 'LASS', 'Assistente']) {
    try {
      await toggleProject(page, proj)
      await page.waitForTimeout(400)
    } catch {
      /* projeto não visível */
    }
    if (await page.locator('[title^="Nova sessão"]').count()) break
  }

  const trigger = page.locator('[title^="Nova sessão"]').first()
  const hasTrigger = (await trigger.count()) > 0
  console.log('HAS_SESSION_TRIGGER=', hasTrigger)
  if (!hasTrigger) {
    await screenshot(page, 'multiline-no-trigger')
    console.log('INCONCLUSIVE: nenhum trigger "Nova sessão" após expandir projetos.')
  } else {
    await trigger.click()
    await page.waitForTimeout(2500)

    // Fecha qualquer modal/dialog que possa ter aberto (Esc é inócuo).
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await screenshot(page, 'multiline-session-open')

    const xterm = page.locator('.xterm:visible').first()
    const hasXterm = (await xterm.count()) > 0
    console.log('HAS_XTERM=', hasXterm)
    if (!hasXterm) {
      console.log('INCONCLUSIVE: nenhum .xterm:visible após abrir sessão.')
    } else {
      await xterm.click({ position: { x: 60, y: 60 } })
      await page.waitForTimeout(400)
      await screenshot(page, 'multiline-00-before')

      const badge = page.getByText('multilinha', { exact: false })
      console.log('BADGE_BEFORE=', await badge.isVisible().catch(() => false))

      await page.keyboard.press('Shift+Enter')
      await page.waitForTimeout(500)
      await screenshot(page, 'multiline-01-shift-enter')
      console.log('BADGE_AFTER_SHIFT_ENTER=', await badge.isVisible().catch(() => false))

      // Enter puro = submit → badge deve sumir. Input vazio é inócuo.
      await page.keyboard.press('Enter')
      await page.waitForTimeout(700)
      await screenshot(page, 'multiline-02-after-enter')
      console.log('BADGE_AFTER_ENTER=', await badge.isVisible().catch(() => false))
    }
  }
} finally {
  stop()
  await app.close()
  console.log('log:', logFile)
}
