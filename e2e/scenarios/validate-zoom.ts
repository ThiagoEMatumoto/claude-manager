import { launchApp } from '../driver/launch'
import { screenshot, captureLogs } from '../driver/capture'
import { waitReady, openSettings } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // (A) aba Atalhos deve listar os comandos de zoom (Aumentar/Diminuir/Resetar fonte).
  try {
    await openSettings(page)
    await page.getByText('Atalhos', { exact: true }).click()
    await page.waitForTimeout(300)
    await screenshot(page, 'zoom-atalhos-tab')
    await page.keyboard.press('Escape')
  } catch (e) {
    console.log('SETTINGS_STEP_ERR=', String(e))
  }

  // (B) zoom global via window listener: Ctrl+= duas vezes (13 -> 15).
  await page.waitForTimeout(200)
  await page.keyboard.press('Control+Equal')
  await page.waitForTimeout(150)
  await page.keyboard.press('Control+Equal')
  await page.waitForTimeout(300)
} finally {
  stop()
  await app.close()
}

// queryDb lê app.db (pós-close pro flush do WAL).
const rows = await queryDb(userDataCopy, "SELECT value FROM app_prefs WHERE key = 'terminal.fontSize'")
console.log('FONTSIZE_PREF=', JSON.stringify(rows))
