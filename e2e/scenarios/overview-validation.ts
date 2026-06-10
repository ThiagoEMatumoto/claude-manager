import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

// Validação da Fase 4 (Visão geral):
// 1 OKR auto_rollup com 1 KR auto_rollup + 2 tarefas no KR (1 done → KR 50 →
// OKR 50), 1 sub-objetivo filho (manual 30), 1 tarefa standalone vencida com
// prioridade alta. Navega até a Visão geral, tira screenshots do dashboard e
// da árvore e confere counts.overdue e o progress do nó do OKR via api.

const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // Dados via api real (IPC + broadcast de verdade)
  const seeded = await page.evaluate(async () => {
    const api = (window as any).api
    const okr = await api.objectives.create({
      title: 'Lançar o produto',
      kind: 'okr',
      progressMode: 'auto_rollup',
    })
    const kr = await api.objectives.createKeyResult({
      objectiveId: okr.id,
      title: 'Entregar onboarding',
      progressMode: 'auto_rollup',
    })
    const krLinks = [{ parentType: 'key_result', parentId: kr.id }]
    await api.tasks.create({ title: 'Desenhar fluxo de cadastro', status: 'done', links: krLinks })
    await api.tasks.create({
      title: 'Implementar tela de boas-vindas',
      status: 'todo',
      links: krLinks,
    })
    await api.objectives.create({
      title: 'Documentação do produto',
      kind: 'project',
      parentObjectiveId: okr.id,
      progressMode: 'manual',
      progressManual: 30,
    })
    await api.tasks.create({
      title: 'Renovar certificado SSL',
      status: 'todo',
      priority: 'high',
      dueDate: Date.now() - 3 * 24 * 60 * 60 * 1000,
    })
    return { okrId: okr.id }
  })

  // Home completa (chips de counts + grid 2×2 com tasks urgentes)
  await page.getByTitle('Home', { exact: true }).click()
  await page.getByText('Lançar o produto').first().waitFor({ state: 'visible' })
  await page.getByText('Renovar certificado SSL').first().waitFor({ state: 'visible' })
  await screenshot(page, 'overview-01-dashboard')

  // Árvore de objetivos agora é colapsável — expandir antes de validar os nós.
  await page.getByRole('button', { name: 'Árvore de objetivos' }).click()
  await page.getByText('Entregar onboarding').first().waitFor({ state: 'visible' })
  await page.getByText('Documentação do produto').first().waitFor({ state: 'visible' })
  await screenshot(page, 'overview-02-tree')

  // overdue >= 1 (a standalone vencida) e nó do OKR com rollup 50
  // (KR: done=100, todo=0 → 50; OKR = média ponderada dos KRs → 50).
  const result = await page.evaluate(async (okrId: string) => {
    const api = (window as any).api
    const overview = await api.objectives.overview()
    const okrNode = overview.objectives.find((n: any) => n.objective.id === okrId)
    return {
      counts: overview.counts,
      overdueOk: overview.counts.overdue >= 1,
      okrProgress: okrNode?.progress ?? null,
      okrProgressOk: okrNode?.progress === 50,
      okrChildren: (okrNode?.children ?? []).map(
        (c: any) => `${c.objective.title} progress=${c.progress}`,
      ),
      pending: overview.pending.map(
        (t: any) => `${t.title} status=${t.status} priority=${t.priority} parents=${t.parents.length}`,
      ),
    }
  }, seeded.okrId)
  console.log('VALIDATION:', JSON.stringify(result, null, 2))
} finally {
  stop()
  await app.close()
}
