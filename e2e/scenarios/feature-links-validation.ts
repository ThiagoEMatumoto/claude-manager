import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

// Validação da Fase 3 (Feature links):
// 1 feature vinculada a um objetivo auto_rollup novo + 2 tarefas na feature
// (1 done, 1 todo → progresso da feature 50 → rollup do objetivo 50). Navega
// pelo doc da feature (seções Tarefas/Objetivos) e pelo detalhe do objetivo
// (seção Features) e confere o rollup via api.

const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // Dados via api real (IPC + broadcast de verdade). Features exigem projectId:
  // reusa o primeiro projeto da cópia do userData; se a cópia estiver vazia,
  // cria um projeto descartável (a cópia é jogada fora no fim).
  const seeded = await page.evaluate(async () => {
    const api = (window as any).api
    const projects = await api.projects.list()
    const project = projects[0] ?? (await api.projects.create({ name: 'E2E Feature Links' }))

    const feature = await api.features.create({
      projectId: project.id,
      title: 'Integração de feature links',
    })
    const objective = await api.objectives.create({
      title: 'Lançar integração de features',
      kind: 'okr',
      progressMode: 'auto_rollup',
    })
    await api.features.setObjectiveLinks({
      featureId: feature.id,
      links: [{ targetType: 'objective', targetId: objective.id }],
    })

    const links = [{ parentType: 'feature', parentId: feature.id }]
    await api.tasks.create({ title: 'Implementar backend de links', status: 'done', links })
    await api.tasks.create({ title: 'Implementar UI de links', status: 'todo', links })

    return {
      projectName: project.name as string,
      featureId: feature.id as string,
      featureTitle: feature.title as string,
      objectiveId: objective.id as string,
      objectiveTitle: objective.title as string,
    }
  })

  // Feature doc: seções Tarefas + Objetivos
  await page.getByTitle('Features', { exact: true }).click()
  await page.getByText(seeded.featureTitle).first().click()
  await page.getByText('Implementar backend de links').first().waitFor({ state: 'visible' })
  await page.getByText(seeded.objectiveTitle).first().waitFor({ state: 'visible' })
  await screenshot(page, 'feature-links-01-feature-doc')

  // Detalhe do objetivo: seção Features com progresso
  await page.getByTitle('Objetivos', { exact: true }).click()
  await page.getByText(seeded.objectiveTitle).first().click()
  await page.getByText(seeded.featureTitle).first().waitFor({ state: 'visible' })
  await screenshot(page, 'feature-links-02-objective-detail')

  // Rollup: feature com 1 done + 1 todo → 50; objetivo sem KRs herda 50
  const result = await page.evaluate(
    async ({ featureId, objectiveId }: { featureId: string; objectiveId: string }) => {
      const api = (window as any).api
      const detail = await api.objectives.get(objectiveId)
      const featureLinks = await api.features.listObjectiveLinks(featureId)
      const featureTasks = await api.tasks.listByParent('feature', featureId)
      const linked = detail.linkedFeatures.find((f: any) => f.id === featureId)
      return {
        objectiveProgress: detail.progress,
        rollupOk: detail.progress === 50,
        linkedFeature: linked
          ? `${linked.title} status=${linked.status} progress=${linked.progress}`
          : null,
        linkedFeatureProgressOk: linked?.progress === 50,
        featureLinks,
        featureTaskCount: featureTasks.length,
      }
    },
    { featureId: seeded.featureId, objectiveId: seeded.objectiveId },
  )
  console.log('VALIDATION:', JSON.stringify(result, null, 2))
} finally {
  stop()
  await app.close()
}
