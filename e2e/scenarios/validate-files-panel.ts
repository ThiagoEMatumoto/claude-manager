import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, toggleProject, waitReady } from '../driver/nav'

// Valida o painel de arquivos: abrir → repo selecionado → a árvore CARREGA entradas
// → abrir um arquivo mostra conteúdo no editor. Captura erros de console pra
// distinguir bug de UI de bug de IPC (assertAllowed rejeitando paths).
const { app, page } = await launchApp()
const { logFile, stop } = captureLogs(app, page)

const treeErrors: string[] = []
page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('listDir falhou') || t.includes('[files-store]')) treeErrors.push(t)
})

const NODE = '[data-testid="file-tree-node"]'
let ok = false
try {
  await waitReady(page)
  await goToArea(page, 'projects')
  await page.waitForTimeout(400)

  // Garante um projeto ativo (popula os roots do painel).
  for (const proj of ['Pessoal', 'Diligencia', 'LASS', 'Assistente']) {
    try {
      await toggleProject(page, proj)
      await page.waitForTimeout(300)
      break
    } catch {
      /* projeto não visível */
    }
  }

  // Abre o painel: clica o toggle (FolderTree); fallback Ctrl+B.
  const toggle = page.locator('[title^="Alternar painel de arquivos"]').first()
  if (await toggle.count()) await toggle.click()
  else await page.keyboard.press('Control+b')
  await page.waitForTimeout(500)

  const panel = page.locator('[data-testid="files-panel"]')
  const panelOpen = (await panel.count()) > 0
  console.log('PANEL_OPEN=', panelOpen)
  await screenshot(page, 'files-01-panel-open')

  if (!panelOpen) {
    console.log('INCONCLUSIVE: painel não abriu.')
  } else {
    const repoOptions = await page.locator('[data-testid="files-repo-select"] option').count()
    console.log('REPO_OPTIONS=', repoOptions)

    // A árvore deve carregar sozinha (root auto-expandido dispara o listDir).
    await page.locator(NODE).nth(1).waitFor({ timeout: 6000 }).catch(() => {})
    const treeLoaded = (await page.locator(NODE).count()) > 1
    console.log('TREE_ENTRIES=', await page.locator(NODE).count(), 'TREE_LOADED=', treeLoaded)
    await screenshot(page, 'files-02-tree')

    // Acha um arquivo (nó não-dir). Se o topo só tiver dirs, expande o 1º dir.
    if ((await page.locator(`${NODE}[data-isdir="false"]`).count()) === 0) {
      const firstDirChild = page.locator(`${NODE}[data-isdir="true"]`).nth(1)
      if (await firstDirChild.count()) {
        await firstDirChild.click()
        await page.waitForTimeout(800)
      }
    }

    let editorHasContent = false
    const firstFile = page.locator(`${NODE}[data-isdir="false"]`).first()
    console.log('FILE_NODES=', await page.locator(`${NODE}[data-isdir="false"]`).count())
    if (await firstFile.count()) {
      await firstFile.click()
      await page.waitForTimeout(700)
      await screenshot(page, 'files-03-file-open')
      const ta = page.locator('[data-testid="file-editor-textarea"]')
      if (await ta.count()) {
        editorHasContent = (await ta.inputValue()).trim().length > 0
      } else {
        editorHasContent = (await page.locator('.markdown-body').count()) > 0
      }
    }
    console.log('EDITOR_HAS_CONTENT=', editorHasContent)

    ok = treeLoaded && editorHasContent && treeErrors.length === 0
  }

  console.log('TREE_CONSOLE_ERRORS=', JSON.stringify(treeErrors))
  console.log('FILES_PANEL_OK=', ok)
} finally {
  stop()
  await app.close()
  console.log('log:', logFile)
}
