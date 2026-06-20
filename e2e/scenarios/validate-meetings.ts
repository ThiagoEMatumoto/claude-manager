import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb, listTables } from '../driver/inspect'

const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await page.getByTitle('Reuniões', { exact: true }).click()
  await page.waitForTimeout(600)
  await screenshot(page, 'meetings-empty')
  await page.getByTitle('Nova reunião', { exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByPlaceholder('Suas notas da reunião').fill('Reunião de teste — validar persistência de notas')
  await page.waitForTimeout(1300) // espera o debounce do auto-save
  await screenshot(page, 'meetings-notes')
} finally {
  stop()
  // O app abre o SQLite em journal_mode=WAL: a migration e o auto-save vivem no
  // app.db-wal até o checkpoint do close. O inspect.ts lê só o app.db via sql.js
  // (ignora o WAL), então só consultamos o DB DEPOIS de fechar o app.
  await app.close()
}

const tables = await listTables(userDataCopy)
console.log('MEETING_TABLES:', tables.filter((t) => t.includes('meeting')))
const rows = await queryDb(userDataCopy, 'SELECT id, title, raw_notes FROM meetings')
console.log('MEETINGS_ROWS:', JSON.stringify(rows))
