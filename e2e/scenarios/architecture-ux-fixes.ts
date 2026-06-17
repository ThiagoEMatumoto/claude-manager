import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

// Wave B UX fixes:
//  (#1) dropdown do seletor de projeto portalizado + alinhado à ESQUERDA do
//       trigger, abrindo SOBRE o canvas/sidebar (sem corte do overflow-hidden).
//  (#2) menu da aresta com "Editar rótulo…" + "Apagar conexão" (danger), e o
//       Dialog de editar rótulo.
const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  const projRows = (await queryDb(
    userDataCopy,
    `SELECT p.id, p.name, COUNT(r.id) AS n
       FROM projects p JOIN repos r ON r.project_id = p.id
      GROUP BY p.id HAVING n >= 2 ORDER BY n DESC`,
  )) as Array<{ id: string; name: string; n: number }>
  console.log('[uxfix] projetos com 2+ repos:', JSON.stringify(projRows))

  // Abre a aba Arquitetura.
  await page.getByTitle('Arquitetura', { exact: true }).click()
  await page.waitForTimeout(1000)

  // (#1) Abre o seletor (1º botão da topbar) — deve abrir alinhado à esquerda,
  // sobre o canvas/sidebar, lista inteira visível (projetos + Global).
  const topbarBtn = page.locator('main > div').first().locator('button').first()
  await topbarBtn.click()
  await page.waitForTimeout(350)
  const hasGlobal = await page.getByText('Global (todos os projetos)').count()
  console.log('[uxfix] opção Global visível no seletor:', hasGlobal)
  await screenshot(page, 'uxfix-01-selector-open-left-aligned')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // Garante um projeto com arestas: seleciona um projeto e cria uma dep se preciso.
  if (projRows.length > 0) {
    await topbarBtn.click()
    await page.waitForTimeout(300)
    const item = page.locator(`body > div button:has-text("${projRows[0].name}")`).last()
    if ((await item.count()) > 0) {
      await item.click({ timeout: 5000 })
      await page.waitForTimeout(1000)
    }
  }

  // Cria uma aresta dentro do projeto atual (com label) pra exercitar o menu.
  const made = (await page.evaluate(async (projName: string) => {
    const projects = await window.api.projects.list()
    const proj = projects.find((p: { name: string }) => p.name === projName) ?? projects[0]
    if (!proj) return { ok: false, reason: 'no-project' }
    const repos = await window.api.projects.listRepos(proj.id)
    if (repos.length < 2) return { ok: false, reason: 'repos<2' }
    const dep = await window.api.repoDeps.create({
      fromRepoId: repos[0].id,
      toRepoId: repos[1].id,
      kind: 'calls-api',
      label: 'rótulo inicial',
    })
    return { ok: true, depId: dep.id }
  }, projRows[0]?.name ?? '')) as { ok: boolean; reason?: string; depId?: string }
  console.log('[uxfix] aresta criada:', JSON.stringify(made))
  await page.waitForTimeout(1000)

  // (#2) Abre o menu da aresta clicando no label e confirma os itens novos.
  const edgeLabelBtn = page.locator('.react-flow__edgelabel-renderer button').first()
  const hasEdge = await edgeLabelBtn.count()
  console.log('[uxfix] labels de aresta:', hasEdge)
  if (hasEdge > 0) {
    await edgeLabelBtn.click({ timeout: 5000 })
    await page.waitForTimeout(400)
    const hasDelete = await page.getByText('Apagar conexão', { exact: true }).count()
    const hasEditLabel = await page.getByText('Editar rótulo…', { exact: true }).count()
    console.log('[uxfix] "Apagar conexão" visível:', hasDelete)
    console.log('[uxfix] "Editar rótulo…" visível:', hasEditLabel)
    await screenshot(page, 'uxfix-02-edge-menu-with-actions')

    // Abre o Dialog de editar rótulo.
    if (hasEditLabel > 0) {
      await page.getByText('Editar rótulo…', { exact: true }).first().click()
      await page.waitForTimeout(400)
      const dialogTitle = await page.getByText('Editar rótulo da conexão', { exact: true }).count()
      console.log('[uxfix] Dialog de editar rótulo aberto:', dialogTitle)
      await screenshot(page, 'uxfix-03-edit-label-dialog')
      await page.keyboard.press('Escape')
    }
  }
} finally {
  stop()
  await app.close()
}
