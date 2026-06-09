import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'

// Validação da Fase 2 (Tarefas):
// 1 objetivo auto_rollup sem KR + 3 tarefas vinculadas (1 done, 1 todo,
// 1 cancelled → rollup esperado 50: cancelada sai do denominador), 1 tarefa
// standalone vencida com prioridade alta. Navega Lista/Board/Pendências e
// confere o rollup via api.

const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // Dados via api real (IPC + broadcast de verdade)
  const seeded = await page.evaluate(async () => {
    const api = (window as any).api
    const objective = await api.objectives.create({
      title: 'Organizar mudança',
      kind: 'personal_goal',
      progressMode: 'auto_rollup',
    })
    const links = [{ parentType: 'objective', parentId: objective.id }]
    await api.tasks.create({ title: 'Contratar transportadora', status: 'done', links })
    await api.tasks.create({ title: 'Encaixotar livros', status: 'todo', links })
    await api.tasks.create({ title: 'Pintar a casa antiga', status: 'cancelled', links })
    await api.tasks.create({
      title: 'Pagar IPTU atrasado',
      status: 'todo',
      priority: 'high',
      dueDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
      tags: ['financeiro'],
    })
    return { objectiveId: objective.id }
  })

  // Lista
  await page.getByTitle('Tarefas', { exact: true }).click()
  await page.getByText('Pagar IPTU atrasado').first().waitFor({ state: 'visible' })
  await screenshot(page, 'tasks-01-list')

  // Board (cancelada cai em "Finalizadas" com badge própria)
  await page.getByTitle('Board', { exact: true }).click()
  await page.getByText('Contratar transportadora').first().waitFor({ state: 'visible' })
  await screenshot(page, 'tasks-02-board')

  // Pendências (só todo/in_progress/blocked; prioridade alta + vencida no topo)
  await page.getByTitle('Pendências', { exact: true }).click()
  await page.getByText('Pagar IPTU atrasado').first().waitFor({ state: 'visible' })
  await screenshot(page, 'tasks-03-pending')

  // Rollup do objetivo: done=100, todo=0, cancelled excluída → (100+0)/2 = 50
  const result = await page.evaluate(async (objectiveId: string) => {
    const api = (window as any).api
    const detail = await api.objectives.get(objectiveId)
    const tasks = await api.tasks.list()
    return {
      objectiveProgress: detail.progress,
      rollupOk: detail.progress === 50,
      taskCount: tasks.length,
      tasks: tasks.map(
        (t: any) =>
          `${t.title} status=${t.status} priority=${t.priority} links=${t.links.length}`,
      ),
    }
  }, seeded.objectiveId)
  console.log('VALIDATION:', JSON.stringify(result, null, 2))
} finally {
  stop()
  await app.close()
}
