/** @vitest-environment node */
// Dedup server-side de auto-tasks (Onda 3): chokepoint no store, não só no
// handler MCP — sessões repetidas recriando "a mesma" tarefa auto (mesmo
// título normalizado + mesmo parent) reusam o id existente em vez de
// duplicar. Mesma estratégia de setup de feature-memory.test.ts — DB real
// (tmp dir), electron mockado.
import { rmSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'task-store-test-'))
  return {
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import { app } from 'electron'
import { closeDb, getDb } from './db'
import { create, list, update } from './task-store'

afterAll(() => {
  closeDb()
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

beforeEach(() => {
  getDb().exec('DELETE FROM task_links; DELETE FROM tasks; DELETE FROM features; DELETE FROM projects;')
  const now = Date.now()
  const db = getDb()
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    'proj-1',
    'Projeto de teste',
    now,
    now,
  )
  // Links validam existência do alvo (Onda 0) — precisa de uma feature real.
  for (const id of ['feat-1', 'feat-2']) {
    db.prepare(
      `INSERT INTO features (id, project_id, slug, title, status, doc_path, synth_mode, origin, created_at, updated_at)
       VALUES (?, 'proj-1', ?, ?, 'pending', ?, 'threshold', 'manual', ?, ?)`,
    ).run(id, id, id, `/tmp/${id}.md`, now, now)
  }
})

describe('create (dedup de auto-tasks)', () => {
  it('reusa a task existente quando origin=auto, título normalizado e parent iguais dentro de 72h', () => {
    const first = create({
      title: 'Revisar vínculo sugerido',
      origin: 'auto',
      links: [{ parentType: 'feature', parentId: 'feat-1' }],
    })

    const second = create({
      title: '  Revisar   vínculo sugerido  ', // espaços/caixa diferentes -> normaliza igual
      origin: 'auto',
      links: [{ parentType: 'feature', parentId: 'feat-1' }],
    })

    expect(second.id).toBe(first.id)
    expect(list()).toHaveLength(1)
  })

  it('NÃO deduplica tasks manuais (só origin=auto)', () => {
    create({ title: 'Mesma tarefa', links: [{ parentType: 'feature', parentId: 'feat-1' }] })
    create({ title: 'Mesma tarefa', links: [{ parentType: 'feature', parentId: 'feat-1' }] })

    expect(list()).toHaveLength(2)
  })

  it('NÃO deduplica quando o parent difere', () => {
    create({ title: 'Mesma tarefa', origin: 'auto', links: [{ parentType: 'feature', parentId: 'feat-1' }] })
    create({ title: 'Mesma tarefa', origin: 'auto', links: [{ parentType: 'feature', parentId: 'feat-2' }] })

    expect(list()).toHaveLength(2)
  })

  it('NÃO deduplica contra uma duplicata já concluída (done)', () => {
    const first = create({
      title: 'Mesma tarefa',
      origin: 'auto',
      links: [{ parentType: 'feature', parentId: 'feat-1' }],
    })
    update({ id: first.id, status: 'done' })

    const second = create({
      title: 'Mesma tarefa',
      origin: 'auto',
      links: [{ parentType: 'feature', parentId: 'feat-1' }],
    })

    expect(second.id).not.toBe(first.id)
    expect(list()).toHaveLength(2)
  })

  it('NÃO deduplica fora da janela de 72h', () => {
    const first = create({
      title: 'Mesma tarefa',
      origin: 'auto',
      links: [{ parentType: 'feature', parentId: 'feat-1' }],
    })
    const staleCreatedAt = Date.now() - 73 * 60 * 60 * 1000
    getDb().prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(staleCreatedAt, first.id)

    const second = create({
      title: 'Mesma tarefa',
      origin: 'auto',
      links: [{ parentType: 'feature', parentId: 'feat-1' }],
    })

    expect(second.id).not.toBe(first.id)
    expect(list()).toHaveLength(2)
  })
})
