import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, toggleProject, waitReady } from '../driver/nav'

// Prova que o seletor de repo do painel SEGUE o pane ativo do dockview: abre 2
// sessões (repos diferentes), alterna o pane ativo e confere que o valor do
// seletor muda junto. Se só der pra abrir 1 sessão, valida ao menos que o seletor
// reflete o repo do pane ativo (não-vazio).
const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)

const SELECT = '[data-testid="files-repo-select"]'
const selValue = () => page.locator(SELECT).inputValue().catch(() => '(none)')

let ok = false
try {
  await waitReady(page)
  await goToArea(page, 'projects')
  await page.waitForTimeout(400)

  for (const proj of ['Pessoal', 'Diligencia', 'LASS', 'Assistente']) {
    try {
      await toggleProject(page, proj)
      await page.waitForTimeout(300)
    } catch {
      /* projeto não visível */
    }
    if ((await page.locator('[title^="Nova sessão"]').count()) >= 2) break
  }

  const triggers = page.locator('[title^="Nova sessão"]')
  const nTriggers = await triggers.count()
  console.log('NEW_SESSION_TRIGGERS=', nTriggers)

  // Abre até 2 sessões em repos distintos.
  const opened = Math.min(2, nTriggers)
  for (let i = 0; i < opened; i++) {
    await triggers.nth(i).click()
    await page.waitForTimeout(2500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  console.log('SESSIONS_OPENED=', opened)

  // Abre o painel de arquivos.
  const toggle = page.locator('[title^="Alternar painel de arquivos"]').first()
  if (await toggle.count()) await toggle.click()
  else await page.keyboard.press('Control+b')
  await page.waitForTimeout(500)
  console.log('PANEL_OPEN=', (await page.locator('[data-testid="files-panel"]').count()) > 0)

  const vActive = await selValue()
  console.log('SELECT_AFTER_LAST_SESSION=', JSON.stringify(vActive))
  await screenshot(page, 'focus-01-last-session')

  if (opened >= 2) {
    // Alterna pro outro pane clicando a 1ª aba do dockview e confere se o seletor muda.
    const tabs = page.locator('.dv-default-tab, .dv-tab')
    const nTabs = await tabs.count()
    console.log('DV_TABS=', nTabs)
    if (nTabs >= 2) {
      await tabs.nth(0).click()
      await page.waitForTimeout(600)
      const vOther = await selValue()
      console.log('SELECT_AFTER_TAB0=', JSON.stringify(vOther))
      await screenshot(page, 'focus-02-tab0')
      // Prova: o seletor seguiu a troca de pane ativo (valores diferentes) e ambos não-vazios.
      ok = vActive !== '(none)' && vOther !== '(none)' && vActive !== vOther
      console.log('SELECTOR_FOLLOWS_ACTIVE_PANE=', ok)
    } else {
      console.log('INCONCLUSIVE: <2 abas do dockview encontradas (seletor de aba pode diferir).')
    }
  } else {
    // Fallback single-session: ao menos o seletor reflete um repo do pane ativo.
    ok = vActive !== '(none)' && vActive.length > 0
    console.log('SINGLE_SESSION_SELECTOR_SET=', ok)
  }

  console.log('FILES_FOCUS_OK=', ok)
} finally {
  stop()
  await app.close()
  console.log('log:', logFile)
}
