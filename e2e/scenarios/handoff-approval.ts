import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const require = createRequire(import.meta.url)

// 1ª subida: roda migrations na cópia (cria a tabela `handoffs`).
const first = await launchApp()
await first.app.close()
const migrated = first.userDataCopy

// Escolhe um repo-alvo real da cópia migrada.
const repos = (await queryDb(
  migrated,
  "SELECT id, label FROM repos ORDER BY label LIMIT 1",
)) as Array<{ id: string; label: string }>
if (repos.length === 0) throw new Error('sem repos na cópia')
const target = repos[0]
console.log('[handoff] target repo:', JSON.stringify(target))

// Insere um handoff pending direto na cópia migrada (sql.js escreve + exporta).
const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
const db = new SQL.Database(readFileSync(join(migrated, 'app.db')))
const now = Date.now()
const prompt = [
  '## Contexto',
  `Trabalho end-to-end delegado para ${target.label}.`,
  '- o repo de origem CONSOME A API deste repo',
  '',
  '## Tarefa',
  'Confirmar se status:"unsupported" é tratado como terminal no crawler_callback (não re-enfileira).',
  '',
  '## Restrições',
  '- [ ] Investigar SOMENTE neste repo.',
  '',
  '## Reporte',
  'Ao terminar, chame handoff_report com handoffId="seed-h1" e um resumo de até 250 palavras.',
].join('\n')
db.run(
  `INSERT INTO handoffs (id, mother_session_id, target_repo_id, child_session_id, feature_id, task, context_json, composed_prompt, status, summary, error, created_at, updated_at)
   VALUES ('seed-h1', NULL, ?, NULL, NULL, ?, NULL, ?, 'pending', NULL, NULL, ?, ?)`,
  [target.id, 'Verificar tratamento de status unsupported no prognosticos', prompt, now, now],
)
writeFileSync(join(migrated, 'app.db'), Buffer.from(db.export()))
db.close()
console.log('[handoff] handoff pending inserido em', migrated)

// 2ª subida: aponta pra cópia migrada+seedada (launchApp copia ela de novo).
process.env.CM_REAL_USERDATA = migrated
const { app, page, userDataCopy } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)
  await page.waitForTimeout(1500)
  await screenshot(page, 'handoff-01-approval-dialog')

  // Verifica que o prompt editável e o título do repo aparecem.
  const sawRepo = await page.getByText(target.label, { exact: false }).count()
  const sawPrompt = await page.getByText('crawler_callback', { exact: false }).count()
  console.log('[handoff] label visível?', sawRepo > 0, '| prompt visível?', sawPrompt > 0)

  // Rejeita (caminho seguro — NÃO spawna processo claude real).
  const reject = page.getByRole('button', { name: /rejeitar/i }).first()
  if (await reject.count()) {
    await reject.click()
    await page.waitForTimeout(800)
    await screenshot(page, 'handoff-02-after-reject')
    const status = await queryDb(userDataCopy, "SELECT status FROM handoffs WHERE id='seed-h1'")
    console.log('[handoff] status após rejeitar:', JSON.stringify(status))
  } else {
    console.log('[handoff] botão Rejeitar não encontrado')
  }
} finally {
  stop()
  await app.close()
}
