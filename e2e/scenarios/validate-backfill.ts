import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, waitReady } from '../driver/nav'

const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await goToArea(page, 'features')
  await page.waitForTimeout(1000)
  await screenshot(page, 'backfill-01-features')

  const btn = page.getByRole('button', {
    name: /Importar features de sess/i,
  })
  const found = (await btn.count()) > 0
  console.log(`[scenario] backfill button found: ${found}`)
  if (!found) {
    console.log('[scenario] BUTTON NOT FOUND — aborting click')
    await screenshot(page, 'backfill-NOTFOUND')
  } else {
    await btn.first().click()
    console.log('[scenario] clicked backfill button')
    await page.waitForTimeout(7000)
    await screenshot(page, 'backfill-02-after-click')

    // Probe for black screen: check if any feature/UI content still renders
    const bodyText = (await page.locator('body').innerText()).slice(0, 200)
    console.log(`[scenario] body text after click (first 200): ${JSON.stringify(bodyText)}`)
    const hasContent = bodyText.trim().length > 0
    console.log(`[scenario] UI has visible text content: ${hasContent}`)
  }
  console.log(`[scenario] log file: ${logFile}`)
} finally {
  stop()
  await app.close()
}
