// Captures README hero screenshots against the ANONYMIZED userData copy.
// Run: npx tsx e2e/scenarios/capture-readme.ts
const ANON = '/home/thiagoematumoto/projetos/pessoal/claude-manager/.worktrees/readme-media/.readme-media-anon'
process.env.CM_REAL_USERDATA = ANON

import { launchApp, resolveRealUserData } from '../driver/launch'
import { screenshot } from '../driver/capture'
import { waitReady, goToArea } from '../driver/nav'
import type { Page } from 'playwright'

console.log('resolveRealUserData ->', resolveRealUserData())

const settle = (p: Page, ms = 1000) => p.waitForTimeout(ms)

async function safe(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (e) {
    console.log(`! ${label}: ${(e as Error).message}`)
  }
}

const { app, page, userDataCopy } = await launchApp()
console.log('userDataCopy:', userDataCopy)

try {
  // Hero-sized window.
  await safe('setBounds', async () => {
    const win = await app.browserWindow(page)
    await win.evaluate((w: { setBounds: (b: unknown) => void }) =>
      w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 }),
    )
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await waitReady(page)
  await settle(page, 1200)

  // (a) Projetos — expand the active project's sidebar tree.
  await safe('projects', async () => {
    await goToArea(page, 'projects')
    await settle(page, 700)
    await page.getByRole('button', { name: 'Personal', exact: false }).first().click()
    await settle(page, 1200)
    await screenshot(page, 'projects')
  })

  // (b) Arquitetura — repo dependency graph. Global + a dense project.
  await safe('arch-global', async () => {
    await page.getByTitle('Arquitetura', { exact: true }).click()
    await settle(page, 700)
    // The selector label is dynamic (project name / "Global" / "Selecione um projeto").
    // Target it structurally: the only button carrying a chevron-down in the arch top bar.
    const selector = page.locator('button:has(svg.lucide-chevron-down)').first()
    await selector.click()
    await settle(page, 300)
    await page.getByText('Global (todos os projetos)', { exact: false }).click()
    await settle(page, 1000)
    await safe('fitview', async () => {
      await page.locator('.react-flow__controls-fitview').click()
      await settle(page, 700)
    })
    await settle(page, 800)
    await screenshot(page, 'architecture-global')
  })

  await safe('arch-diligence', async () => {
    await page.locator('button:has(svg.lucide-chevron-down)').first().click()
    await settle(page, 300)
    // Menu items are <button> (graph node labels are <span>) → role disambiguates.
    await page.getByRole('button', { name: 'Diligence', exact: true }).click()
    await settle(page, 1000)
    await safe('fitview2', async () => {
      await page.locator('.react-flow__controls-fitview').click()
      await settle(page, 700)
    })
    await settle(page, 600)
    await screenshot(page, 'architecture-diligence')
  })

  // (c) Métricas
  await safe('metrics', async () => {
    await goToArea(page, 'metrics')
    await settle(page, 1500)
    await screenshot(page, 'metrics')
  })

  // (d) Features — board view
  await safe('features', async () => {
    await goToArea(page, 'features')
    await settle(page, 700)
    await safe('board-toggle', async () => {
      await page.getByTitle('Board', { exact: true }).click()
      await settle(page, 900)
    })
    await screenshot(page, 'features')
  })

  console.log('captures done')
} finally {
  await app.close()
}
