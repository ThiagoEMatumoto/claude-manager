import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { goToArea, waitReady } from '../driver/nav'

// Validação da Fase 1 (Objetivos + KRs):
// 1 OKR com 2 KRs (metric peso 1 = 40%, manual peso 3 = 80% → rollup 70%),
// 1 meta pessoal sem KR (manual 25%), filtros por kind, área Features intacta.

const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  await page.getByTitle('Objetivos', { exact: true }).click()
  await screenshot(page, 'obj-01-empty')

  // Cria o OKR pela UI (exercita o dialog real)
  await page.getByTitle('Novo objetivo', { exact: true }).click()
  await page.getByPlaceholder('Ex: aumentar autonomia financeira').fill('Lançar v1 do produto')
  await page.getByRole('button', { name: 'Criar', exact: true }).click()
  await page.getByText('Lançar v1 do produto').first().waitFor({ state: 'visible' })
  await screenshot(page, 'obj-02-okr-created')

  // KRs via api real (IPC + broadcast de verdade)
  const result = await page.evaluate(async () => {
    const api = (window as any).api
    const list = await api.objectives.list()
    const okr = list.find((o: any) => o.title === 'Lançar v1 do produto')
    await api.objectives.createKeyResult({
      objectiveId: okr.id,
      title: 'Onboarding de 100 usuários',
      progressMode: 'metric',
      baseline: 0,
      current: 40,
      target: 100,
      direction: 'increase',
      weight: 1,
    })
    await api.objectives.createKeyResult({
      objectiveId: okr.id,
      title: 'Documentação completa',
      progressMode: 'manual',
      progressManual: 80,
      weight: 3,
    })
    await api.objectives.create({
      title: 'Correr 3x por semana',
      kind: 'personal_goal',
      progressMode: 'manual',
      progressManual: 25,
      tags: ['saude'],
    })
    const detail = await api.objectives.get(okr.id)
    const after = await api.objectives.list()
    return {
      okrProgress: detail.progress,
      krCount: detail.keyResults.length,
      titles: after.map((o: any) => `${o.title} kind=${o.kind} progress=${o.progress}`),
    }
  })
  console.log('VALIDATION:', JSON.stringify(result, null, 2))

  // Detalhe do OKR deve refletir o broadcast (rollup 70%)
  await page.getByText('Documentação completa').waitFor({ state: 'visible', timeout: 5_000 })
  await screenshot(page, 'obj-03-okr-detail-rollup')

  // Lista com os dois objetivos
  await page.getByTitle('Voltar para a lista', { exact: true }).click()
  await page.getByText('Correr 3x por semana').first().waitFor({ state: 'visible' })
  await screenshot(page, 'obj-04-list')

  // Filtro por kind
  await page.getByRole('button', { name: 'meta pessoal', exact: true }).click()
  await screenshot(page, 'obj-05-filter-personal')

  // Features intacta
  await goToArea(page, 'features')
  await screenshot(page, 'obj-06-features-intact')
} finally {
  stop()
  await app.close()
}
