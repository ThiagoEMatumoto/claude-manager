import { waitReady } from '../driver/nav'
import { expect, test } from './_base'

// Regressão barata (sem custo, sem claude -p/Tavily real): o app real do dev
// tem TAVILY_API_KEY configurada em Configurações (drive-app copia o userData
// real — ver e2e/driver/launch.ts), então a área Dossiês não deve mostrar o
// aviso "Busca web desligada". Cobre a classe de bug "aviso ficou órfão
// mesmo com a chave presente" sem gastar nenhuma chamada real de rede/LLM.
test('Dossiês não mostra aviso de busca web desligada com TAVILY_API_KEY configurada', async ({
  cm,
}) => {
  const { page } = cm
  await waitReady(page)
  await page.getByRole('button', { name: 'Dossiês' }).click()
  await page.getByRole('heading', { name: 'Dossiês' }).waitFor({ timeout: 10_000 })
  await expect(page.getByText('Busca web desligada', { exact: false })).not.toBeVisible({
    timeout: 5_000,
  })
})
