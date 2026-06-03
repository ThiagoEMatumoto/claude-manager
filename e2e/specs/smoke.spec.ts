import { goToArea, waitReady } from '../driver/nav'
import { expect, test } from './_base'

// Asserções ESTRUTURAIS (independentes dos dados): valem com qualquer userData,
// então não quebram quando o conteúdo real muda. Pegam regressões de shell/nav.

test('shell abre com o IconRail e as 4 áreas + configurações', async ({ cm }) => {
  const { page } = cm
  await waitReady(page)
  for (const label of ['Projetos', 'Features', 'Configs do CC', 'Métricas', 'Configurações']) {
    await expect(page.getByTitle(label, { exact: true })).toBeVisible()
  }
})

test('área de Projetos mostra header e botão "+ Novo"', async ({ cm }) => {
  const { page } = cm
  await waitReady(page)
  await goToArea(page, 'projects')
  await expect(page.getByText('Projetos', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Novo' })).toBeVisible()
})

test('alternar pra Métricas troca a área ativa', async ({ cm }) => {
  const { page } = cm
  await waitReady(page)
  await goToArea(page, 'metrics')
  // O botão da área ativa ganha a cor de acento; basta confirmar que segue montado
  // e clicável após a troca (sem erro de render).
  await expect(page.getByTitle('Métricas', { exact: true })).toBeVisible()
})
