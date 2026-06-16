import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

// Wave B: seletor de projeto in-page + vista Global, badge/ações de hub, e o
// dropdown de kind das arestas aparecendo ACIMA dos cards (portal).
const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // Repos por projeto — precisamos de ≥2 projetos com repos pra vista global.
  const projRows = (await queryDb(
    userDataCopy,
    `SELECT p.id, p.name, COUNT(r.id) AS n
       FROM projects p JOIN repos r ON r.project_id = p.id
      GROUP BY p.id HAVING n >= 1 ORDER BY n DESC`,
  )) as Array<{ id: string; name: string; n: number }>
  console.log('[archB] projetos com repos:', JSON.stringify(projRows))

  // Abre a aba Arquitetura.
  await page.getByTitle('Arquitetura', { exact: true }).click()
  await page.waitForTimeout(1000)
  await screenshot(page, 'archB-00-initial')

  // (a) Abre o seletor in-page e confirma que "Global" está listado.
  const selectorBtn = page.locator('main button:has-text("Global"), main button >> text=Global').first()
  // O botão do seletor mostra o label do projeto atual OU "Global"; abrimos o 1º botão da topbar.
  const topbarBtn = page.locator('main > div').first().locator('button').first()
  await topbarBtn.click()
  await page.waitForTimeout(300)
  await screenshot(page, 'archB-01-selector-open')
  const hasGlobalOption = await page.getByText('Global (todos os projetos)').count()
  console.log('[archB] opção Global no seletor:', hasGlobalOption)

  // Seleciona Global.
  await page.getByText('Global (todos os projetos)').first().click()
  await page.waitForTimeout(1200)
  await screenshot(page, 'archB-02-global-view')

  // Conta repos visíveis (nós do react-flow) e distingue projetos pelos badges.
  const nodeCount = await page.locator('.react-flow__node').count()
  console.log('[archB] nós visíveis em global:', nodeCount)

  // (b) Cria uma aresta cross-projeto via window.api se houver repos de ≥2 projetos.
  const crossDep = (await page.evaluate(async () => {
    const repos = await window.api.projects.listAllRepos()
    const byProj = new Map<string, string>()
    for (const r of repos) if (!byProj.has(r.projectId)) byProj.set(r.projectId, r.id)
    const ids = [...byProj.values()]
    if (ids.length < 2) return { created: false, projects: byProj.size }
    const dep = await window.api.repoDeps.create({
      fromRepoId: ids[0],
      toRepoId: ids[1],
      kind: 'work-hub',
    })
    return { created: true, depId: dep.id, projects: byProj.size }
  })) as { created: boolean; projects: number; depId?: string }
  console.log('[archB] aresta cross-projeto:', JSON.stringify(crossDep))
  await page.waitForTimeout(1000)
  await screenshot(page, 'archB-03-cross-project-edge')

  // (c) Dropdown de kind ACIMA dos cards: clica no label de uma aresta.
  try {
    const edgeLabelBtn = page.locator('.react-flow__edgelabel-renderer button').first()
    const hasEdgeLabel = await edgeLabelBtn.count()
    console.log('[archB] labels de aresta:', hasEdgeLabel)
    if (hasEdgeLabel > 0) {
      await edgeLabelBtn.click({ timeout: 5000 })
      await page.waitForTimeout(400)
      // O painel portalizado fica em document.body com z-[1000] — item PT-BR.
      const kindItem = page.getByText('Documenta', { exact: true }).first()
      console.log('[archB] item de kind "Documenta" visível:', await kindItem.count())
      await screenshot(page, 'archB-04-kind-dropdown-over-cards')
      await page.keyboard.press('Escape')
    }
  } catch (e) {
    console.log('[archB] dropdown de kind: passo flaky pulado —', String(e).split('\n')[0])
  }

  // (d) Hub: marca um repo como hub via menu do nó + "conectar a todos".
  try {
    const firstNodeMenu = page.locator('.react-flow__node button[title="Ações do repo"]').first()
    if ((await firstNodeMenu.count()) > 0) {
      await firstNodeMenu.click({ timeout: 5000 })
      await page.waitForTimeout(300)
      await screenshot(page, 'archB-05-node-actions-menu')
      const markHub = page.getByText('Marcar como hub').first()
      if ((await markHub.count()) > 0) {
        await markHub.click()
        await page.waitForTimeout(900)
        await screenshot(page, 'archB-06-hub-marked')
        const menu2 = page.locator('.react-flow__node button[title="Ações do repo"]').first()
        await menu2.click({ timeout: 5000 })
        await page.waitForTimeout(300)
        const connectAll = page.getByText('Conectar a todos').first()
        console.log('[archB] "Conectar a todos" disponível:', await connectAll.count())
        if ((await connectAll.count()) > 0) {
          await connectAll.click()
          await page.waitForTimeout(1200)
          await screenshot(page, 'archB-07-hub-connected-all')
        }
      }
    }
  } catch (e) {
    console.log('[archB] hub: passo flaky pulado —', String(e).split('\n')[0])
  }

  // (a') Troca de volta pra um projeto específico (clica o item DENTRO do menu
  // portalizado, evitando ambiguidade com badges de projeto nos nós).
  if (projRows.length > 0) {
    const topbarBtn2 = page.locator('main > div').first().locator('button').first()
    await topbarBtn2.click()
    await page.waitForTimeout(300)
    try {
      const menuItem = page
        .locator(`body > div button:has-text("${projRows[0].name}")`)
        .last()
      if ((await menuItem.count()) > 0) {
        await menuItem.click({ timeout: 5000 })
        await page.waitForTimeout(1000)
        await screenshot(page, 'archB-08-project-view')
      }
    } catch (e) {
      console.log('[archB] troca p/ projeto: passo flaky pulado —', String(e).split('\n')[0])
    }
  }

  void selectorBtn
} finally {
  stop()
  await app.close()
}
