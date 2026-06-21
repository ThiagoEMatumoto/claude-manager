import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await page.getByTitle('Reuniões', { exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByTitle('Nova reunião', { exact: true }).click()
  await page.waitForTimeout(500)
  await screenshot(page, 'live-00-idle')
  await page.getByRole('button', { name: /iniciar/i }).click()
  await page.waitForTimeout(3500)
  await screenshot(page, 'live-01-streaming')
  await page.waitForTimeout(4500)
  await screenshot(page, 'live-02-done')
} finally {
  stop(); await app.close()
}
const segs = await queryDb(userDataCopy, 'SELECT idx, speaker_label, text FROM meeting_segments ORDER BY idx')
console.log('SEGMENTS_COUNT:', segs.length)
console.log('SEGMENTS_SAMPLE:', JSON.stringify(segs.slice(0, 3)))
const m = await queryDb(userDataCopy, 'SELECT status FROM meetings ORDER BY created_at DESC LIMIT 1')
console.log('MEETING_STATUS:', JSON.stringify(m))
