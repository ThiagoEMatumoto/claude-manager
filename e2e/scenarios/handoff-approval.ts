import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

  // Aprova: spawna a sessão-filha real no repo-alvo. O claude pode não autenticar,
  // mas o arquivo de system-prompt é ESCRITO ANTES do spawn — é o que provamos.
  const approve = page.getByRole('button', { name: /aprovar e abrir sess/i }).first()
  if (await approve.count()) {
    await approve.click()
    await page.waitForTimeout(6000)
    await screenshot(page, 'handoff-02-after-approve')

    // (a) Sessão nova criada pro repo-alvo. Lido via IPC do app vivo (não via
    // queryDb): o app usa SQLite em WAL e os writes recentes ficam no -wal, que o
    // sql.js do queryDb NÃO enxerga. A API IPC lê o estado real (WAL incluído).
    const sessions = (await page.evaluate(async (repoId) => {
      const all = await window.api.sessions.list()
      return all.filter((s: { repoId: string | null }) => s.repoId === repoId)
    }, target.id)) as Array<{ id: string; status: string; repoId: string | null }>
    console.log('[handoff] sessões IPC pro target:', JSON.stringify(sessions))

    // (b) Arquivo de system-prompt íntegro em <userData>/tmp/handoff-*.md.
    const tmpDir = join(userDataCopy, 'tmp')
    let handoffFile: string | null = null
    if (existsSync(tmpDir)) {
      const f = readdirSync(tmpDir).find((n) => n.startsWith('handoff-') && n.endsWith('.md'))
      if (f) handoffFile = join(tmpDir, f)
    }
    if (handoffFile) {
      const content = readFileSync(handoffFile, 'utf8')
      const hasContexto = content.includes('## Contexto')
      const hasRestricoes = content.includes('## Restrições')
      const hasReporte = content.includes('## Reporte')
      const hasHandoffId = content.includes('seed-h1')
      console.log('[handoff] arquivo:', handoffFile)
      console.log(
        '[handoff] conteúdo íntegro? Contexto=%s Restrições=%s Reporte=%s handoffId=%s',
        hasContexto,
        hasRestricoes,
        hasReporte,
        hasHandoffId,
      )
    } else {
      console.log('[handoff] ARQUIVO handoff-*.md NÃO encontrado em', tmpDir)
    }

    // (c) Handoff foi a running. Também via IPC (mesma razão do WAL acima).
    const handoffStatus = (await page.evaluate(async () => {
      const list = await window.api.handoffs.list()
      return list.find((h: { id: string }) => h.id === 'seed-h1')?.status ?? null
    })) as string | null
    console.log('[handoff] status IPC após aprovar:', JSON.stringify(handoffStatus))
  } else {
    console.log('[handoff] botão Aprovar não encontrado')
  }
} finally {
  stop()
  await app.close()
}
