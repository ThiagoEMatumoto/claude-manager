import { captureLogs, screenshot } from '../driver/capture'
import { launchApp } from '../driver/launch'
import { goToArea, waitReady } from '../driver/nav'

// Valida visualmente as 2 features novas do worktree feat-board-launcher:
//  (1) toggle Lista↔Board na área Features, com colunas por status;
//  (2) command launcher na palette ("Lançar com comando…" → lista buscável).
async function main() {
  const { app, page, userDataCopy } = await launchApp()
  const { logFile, stop } = captureLogs(app, page)
  const shots: Record<string, string> = {}
  let paletteShortcut = '(none)'
  try {
    await waitReady(page)
    await goToArea(page, 'features')
    await page.waitForTimeout(800)
    shots.featuresList = await screenshot(page, '01-features-list')

    // --- Feature 1: Board ---
    // O board só renderiza quando nenhuma feature está selecionada (selectedId null).
    await page.getByTitle('Board', { exact: true }).click()
    // Espera ao menos uma coluna do board aparecer.
    await page.getByText('Em andamento', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForTimeout(500)
    shots.featuresBoard = await screenshot(page, '02-features-board')

    const cols = await Promise.all(
      ['Em andamento', 'Concluídas', 'Arquivadas'].map((t) =>
        page.getByText(t, { exact: true }).count(),
      ),
    )
    console.log(`  colunas board (andamento/concluídas/arquivadas) counts: ${cols.join('/')}`)

    // --- Feature 2: Command launcher na palette ---
    // Tenta Control+K (mod no Linux). Fallback Meta+K.
    await page.keyboard.press('Control+KeyK')
    let paletteVisible = await page
      .getByPlaceholder('Buscar ações, projetos, repos…')
      .isVisible()
      .catch(() => false)
    if (paletteVisible) {
      paletteShortcut = 'Control+K'
    } else {
      await page.keyboard.press('Meta+KeyK')
      await page.waitForTimeout(300)
      paletteVisible = await page
        .getByPlaceholder('Buscar ações, projetos, repos…')
        .isVisible()
        .catch(() => false)
      if (paletteVisible) paletteShortcut = 'Meta+K'
    }
    console.log(`  palette aberta via: ${paletteShortcut} (visível=${paletteVisible})`)
    await page.waitForTimeout(400)
    shots.paletteOpen = await screenshot(page, '03-palette-open')

    // Aciona a entrada do launcher.
    const launcherEntry = page.getByRole('button', { name: 'Lançar com comando…' })
    const launcherFound = await launcherEntry.count()
    console.log(`  entrada 'Lançar com comando…' encontrada: ${launcherFound > 0}`)
    if (launcherFound > 0) {
      await launcherEntry.first().click()
      // Passo pick-item: placeholder muda e a lista de skills/commands aparece.
      await page
        .getByPlaceholder('Buscar skill ou /command para lançar…')
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => {})
      await page.waitForTimeout(600)
    }
    shots.paletteLauncher = await screenshot(page, '04-palette-launcher')

    const launcherGroups = await Promise.all(
      ['Skills', 'Comandos'].map((g) => page.getByText(g, { exact: true }).count()),
    )
    console.log(`  grupos no launcher (Skills/Comandos) counts: ${launcherGroups.join('/')}`)

    console.log('\nOK — cenário concluído.')
    console.log(`  userData (cópia): ${userDataCopy}`)
    for (const [k, v] of Object.entries(shots)) console.log(`  ${k}: ${v}`)
    console.log(`  log: ${logFile}`)
  } catch (err) {
    console.error('ERRO durante o cenário:', err)
    try {
      shots.error = await screenshot(page, '99-error-state')
      console.error(`  screenshot do estado de erro: ${shots.error}`)
    } catch {}
    throw err
  } finally {
    stop()
    await app.close()
  }
}

main().catch((err) => {
  console.error('FALHA no cenário:', err)
  process.exit(1)
})
