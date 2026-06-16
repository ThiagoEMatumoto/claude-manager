import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { launchApp } from '../driver/launch'
import { captureLogs, screenshot } from '../driver/capture'
import { waitReady } from '../driver/nav'
import { queryDb } from '../driver/inspect'

const require = createRequire(import.meta.url)

// 1ª subida: roda migrations na cópia (cria as tabelas).
const first = await launchApp()
await first.app.close()
const migrated = first.userDataCopy

// O projeto auto-ativado pelo app não é determinístico só pela ordenação do DB
// (restoreWorkspace pode restaurar o último ativo). Pra o badge aparecer seja qual
// for o projeto ativo, seeda um handoff `done` no PRIMEIRO repo de CADA projeto.
const firsts = (await queryDb(
  migrated,
  `SELECT p.id AS pid, p.name AS pname,
          (SELECT r.id FROM repos r WHERE r.project_id = p.id
            ORDER BY r.position ASC, r.created_at ASC LIMIT 1) AS rid,
          (SELECT r.label FROM repos r WHERE r.project_id = p.id
            ORDER BY r.position ASC, r.created_at ASC LIMIT 1) AS rlabel
     FROM projects p`,
)) as Array<{ pid: string; pname: string; rid: string | null; rlabel: string | null }>
const targets = firsts.filter((f) => f.rid)
if (targets.length === 0) throw new Error('nenhum projeto com repos na cópia')
console.log('[trail] seedando badge no 1º repo de', targets.length, 'projetos')

const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
const db = new SQL.Database(readFileSync(join(migrated, 'app.db')))
const now = Date.now()
for (const [i, tg] of targets.entries()) {
  db.run(
    `INSERT INTO handoffs (id, mother_session_id, target_repo_id, child_session_id, feature_id, task, context_json, composed_prompt, status, summary, error, created_at, updated_at)
     VALUES (?, NULL, ?, NULL, NULL, 'Implementar badge de trilha', NULL, '## Tarefa', 'done', 'Badge entregue.', NULL, ?, ?)`,
    [`trail-done-${i}`, tg.rid, now, now],
  )
}
writeFileSync(join(migrated, 'app.db'), Buffer.from(db.export()))
db.close()
console.log('[trail] handoffs done seedados:', targets.map((t) => t.rlabel).join(', '))

// 2ª subida: aponta pra cópia migrada+seedada.
process.env.CM_REAL_USERDATA = migrated
const { app, page } = await launchApp()
const { stop } = captureLogs(app, page)
try {
  await waitReady(page)

  // O pending? Não há — só `done`. Mas garante que nenhum gate fique no caminho.
  const gateReject = page.getByRole('button', { name: /rejeitar/i }).first()
  if (await gateReject.count()) {
    await gateReject.click()
    await page.waitForTimeout(500)
  }

  // O app auto-ativa projects[0] (= o projeto-alvo seedado). Sem toggleProject.
  await page.getByTitle('Arquitetura', { exact: true }).click()
  await page.waitForTimeout(1200)
  await screenshot(page, 'trail-01-canvas-with-badge')

  // O badge é um button com title "1 handoff(s) — abrir inbox".
  const badge = page.getByTitle(/handoff\(s\) — abrir inbox/i).first()
  const sawBadge = await badge.count()
  console.log('[trail] badge visível?', sawBadge > 0)
  if (sawBadge > 0) {
    await badge.click()
    await page.waitForTimeout(900)
    await screenshot(page, 'trail-02-after-badge-click-inbox')
    // Após o clique deve estar na área Handoffs (inbox).
    const inInbox = await page.getByText('Implementar badge de trilha', { exact: false }).count()
    console.log('[trail] navegou ao inbox?', inInbox > 0)
  }

  // Volta à Arquitetura e tenta conectar um nó nele mesmo (self-loop).
  await page.getByTitle('Arquitetura', { exact: true }).click()
  await page.waitForTimeout(800)
  const depsBefore = (await queryDb(
    migrated,
    'SELECT COUNT(*) AS c FROM repo_dependencies',
  )) as Array<{ c: number }>
  // Arrasta do handle source (direita) p/ o handle target (esquerda) do MESMO nó.
  const node = page.locator('.react-flow__node').first()
  const nb = await node.boundingBox()
  if (nb) {
    const srcX = nb.x + nb.width - 2 // handle source à direita
    const tgtX = nb.x + 2 // handle target à esquerda
    const midY = nb.y + nb.height / 2
    await page.mouse.move(srcX, midY)
    await page.mouse.down()
    await page.mouse.move(tgtX, midY, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(800)
  }
  await screenshot(page, 'trail-03-after-self-connect-attempt')
  const depsAfter = (await queryDb(
    migrated,
    'SELECT COUNT(*) AS c FROM repo_dependencies',
  )) as Array<{ c: number }>
  console.log(
    '[trail] deps antes/depois do self-connect:',
    depsBefore[0]?.c,
    depsAfter[0]?.c,
    '(iguais = self-connection bloqueada)',
  )
} finally {
  stop()
  await app.close()
}
