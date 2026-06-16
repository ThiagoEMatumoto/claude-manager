import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady, goToArea, toggleProject } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // Acha um projeto com 2+ repos pra o canvas ter o que mostrar.
  const rows = (await queryDb(
    userDataCopy,
    `SELECT p.id, p.name, COUNT(r.id) AS n
       FROM projects p JOIN repos r ON r.project_id = p.id
      GROUP BY p.id HAVING n >= 2 ORDER BY n DESC`,
  )) as Array<{ id: string; name: string; n: number }>
  console.log('[arch] projetos com 2+ repos:', JSON.stringify(rows))

  if (rows.length > 0) {
    await goToArea(page, 'projects')
    await toggleProject(page, rows[0].name)
    await page.waitForTimeout(400)
  }

  // Clica na aba Arquitetura (title do novo botão da IconRail).
  await page.getByTitle('Arquitetura', { exact: true }).click()
  await page.waitForTimeout(1200)
  await screenshot(page, 'architecture-01-canvas')

  // Tenta criar uma conexão arrastando entre dois handles (best-effort).
  const handles = page.locator('.react-flow__handle')
  const count = await handles.count()
  console.log('[arch] react-flow handles encontrados:', count)
  if (count >= 2) {
    const a = await handles.nth(0).boundingBox()
    const b = await handles.nth(count - 1).boundingBox()
    if (a && b) {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(800)
      await screenshot(page, 'architecture-02-after-connect')
    }
  }
} finally {
  stop()
  await app.close()
}
