import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await goToArea(page, 'projects')
  await screenshot(page, '01-sidebar')

  // Feature A: criar repo do zero no 1º projeto COM vault (a aba "Criar do zero"
  // fica desabilitada em projeto sem vault). Pasta descartável, removida depois.
  const projectItems = page.locator('aside ul li')
  const projectCount = await projectItems.count()
  let targetProject: ReturnType<typeof projectItems.nth> | null = null
  for (let i = 0; i < projectCount; i++) {
    const item = projectItems.nth(i)
    // Projetos sem vault exibem o badge "sem vault" — pulamos esses.
    if ((await item.getByText('sem vault', { exact: true }).count()) === 0) {
      targetProject = item
      break
    }
  }

  if (targetProject) {
    const projectName = (await targetProject.locator('span.truncate').first().innerText()).trim()
    console.log('[scenario] expandindo projeto:', projectName)
    // Clica no NOME do projeto (botão de toggle), não no li inteiro — o li também
    // contém o grip de drag e o menu de ações.
    await targetProject.locator('span.truncate').first().click()
    await page.waitForTimeout(800)

    // Com 0 repos o painel mostra "+ Adicionar repo"; com repos existentes, "+ repo".
    const addRepoBtn = page.getByText(/^\+ (Adicionar repo|repo)$/).first()
    await addRepoBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await addRepoBtn.click()
    await page.waitForTimeout(400)
    await page.getByText('Criar do zero', { exact: true }).click()
    await page.waitForTimeout(300)
    await screenshot(page, '02-create-blank-tab')
    await page.getByPlaceholder('meu-repo').fill('cm-drive-e2e-tmp')
    // Um dv-sash (splitter do dockview) intercepta pointer events sobre o footer
    // do dialog — dispatchEvent dispara o onClick sem hit-testing.
    await page.getByRole('button', { name: 'Criar', exact: true }).dispatchEvent('click')
    await page.waitForTimeout(2500)
    await screenshot(page, '03-blank-repo-created')
    try {
      const repos = await queryDb(
        userDataCopy,
        "SELECT label, path, link_kind, source FROM repos WHERE label = 'cm-drive-e2e-tmp'",
      )
      console.log('[scenario] repo criado:', JSON.stringify(repos))
    } catch (err) {
      console.log('[scenario] queryDb repos falhou (WAL?):', String(err))
    }
  } else {
    console.log('[scenario] nenhum projeto com vault na sidebar — pulando Feature A')
  }

  // Feature B: sessão avulsa
  await page.getByText('Sessão rápida', { exact: true }).click()
  await page.waitForTimeout(4000)
  await screenshot(page, '04-quick-session')

  await page.keyboard.press('Control+Shift+A')
  await page.waitForTimeout(600)
  await screenshot(page, '05-switcher-avulsas')

  try {
    const rows = await queryDb(
      userDataCopy,
      'SELECT repo_id, title, status FROM sessions ORDER BY started_at DESC LIMIT 3',
    )
    console.log('[scenario] últimas sessões:', JSON.stringify(rows))
  } catch (err) {
    console.log('[scenario] queryDb sessions falhou (WAL?):', String(err))
  }
} finally {
  stop()
  await app.close()
}
