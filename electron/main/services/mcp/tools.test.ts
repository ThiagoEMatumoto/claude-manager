/** @vitest-environment node */
// Unit dos handlers MCP contra um DB better-sqlite3 real (tmp dir), com o
// electron mockado (app.getPath → tmp) e o notify espiado. Mesma estratégia
// dos testes de migration: schema real via runMigrations, sem janela.
import { rmSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'mcp-tools-test-'))
  return {
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import { app } from 'electron'
import { closeDb, getDb } from '../db'
import { buildTools, type McpNotify, type ToolDef } from './tools'
import type { KeyResult, Objective, ObjectiveDetail } from '../../../../shared/types/ipc'

interface NotifySpy extends McpNotify {
  calls: Array<[string, unknown]>
  affected: unknown[][]
}

function makeNotify(): NotifySpy {
  const calls: Array<[string, unknown]> = []
  const affected: unknown[][] = []
  return {
    calls,
    affected,
    broadcast: (channel, payload) => calls.push([channel, payload]),
    affectedObjectives: (links) => affected.push(links),
    affectedObjectivesForFeatureLinks: (links) => affected.push(links),
  }
}

let notify: NotifySpy
let tools: ToolDef[]

function tool(name: string): ToolDef {
  const def = tools.find((t) => t.name === name)
  if (!def) throw new Error(`tool not registered: ${name}`)
  return def
}

function call<T>(name: string, args: unknown): T {
  return tool(name).handler(args).structuredContent as T
}

beforeEach(() => {
  notify = makeNotify()
  tools = buildTools(notify)
})

afterAll(() => {
  closeDb()
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

describe('mcp tools — objectives/KRs', () => {
  it('objective_create persiste, broadcasta e retorna o objetivo', () => {
    const { objective } = call<{ objective: Objective }>('objective_create', {
      title: 'Lançar o MCP',
      kind: 'okr',
      description: 'Server embutido',
    })
    expect(objective.id).toBeTruthy()
    expect(objective.title).toBe('Lançar o MCP')
    expect(objective.kind).toBe('okr')

    const row = getDb().prepare('SELECT title FROM objectives WHERE id = ?').get(objective.id) as {
      title: string
    }
    expect(row.title).toBe('Lançar o MCP')
    expect(notify.calls).toEqual([['objective:updated', objective]])
  })

  it('objective_create rejeita input inválido (zod)', () => {
    expect(() => tool('objective_create').handler({ title: '', kind: 'okr' })).toThrow()
    expect(() => tool('objective_create').handler({ title: 'X', kind: 'nope' })).toThrow()
    expect(notify.calls).toEqual([])
  })

  it('objective_list filtra e objective_get retorna detalhe com KRs', () => {
    const { objective } = call<{ objective: Objective }>('objective_create', {
      title: 'Com KR',
      kind: 'project',
    })
    const { keyResult } = call<{ keyResult: KeyResult }>('key_result_create', {
      objectiveId: objective.id,
      title: 'KR 1',
    })
    expect(keyResult.objectiveId).toBe(objective.id)
    // create do KR broadcasta o marcador {id, keyResultId}.
    expect(notify.calls.at(-1)).toEqual([
      'objective:updated',
      { id: objective.id, keyResultId: keyResult.id },
    ])

    const { items } = call<{ items: Objective[] }>('objective_list', { kind: 'project' })
    expect(items.some((o) => o.id === objective.id)).toBe(true)
    expect(items.every((o) => o.kind === 'project')).toBe(true)

    const { objective: detail } = call<{ objective: ObjectiveDetail }>('objective_get', {
      id: objective.id,
    })
    expect(detail.keyResults.map((k) => k.id)).toContain(keyResult.id)
  })

  it('objective_get retorna null quando não existe', () => {
    const { objective } = call<{ objective: null }>('objective_get', { id: 'nao-existe' })
    expect(objective).toBeNull()
  })

  it('objective_update muda só os campos enviados', () => {
    const { objective } = call<{ objective: Objective }>('objective_create', {
      title: 'Antes',
      kind: 'custom',
      owner: 'thiago',
    })
    const { objective: updated } = call<{ objective: Objective }>('objective_update', {
      id: objective.id,
      title: 'Depois',
    })
    expect(updated.title).toBe('Depois')
    expect(updated.owner).toBe('thiago')
    expect(notify.calls.at(-1)).toEqual(['objective:updated', updated])
  })

  it('objective_archive arquiva e broadcasta o marcador', () => {
    const { objective } = call<{ objective: Objective }>('objective_create', {
      title: 'Arquivável',
      kind: 'custom',
    })
    const out = call<{ id: string; archived: boolean }>('objective_archive', { id: objective.id })
    expect(out).toEqual({ id: objective.id, archived: true })
    const row = getDb()
      .prepare('SELECT archived_at FROM objectives WHERE id = ?')
      .get(objective.id) as { archived_at: number | null }
    expect(row.archived_at).not.toBeNull()
    expect(notify.calls.at(-1)).toEqual(['objective:updated', { id: objective.id, archived: true }])
  })

  it('key_result_update altera o KR e broadcasta o marcador', () => {
    const { objective } = call<{ objective: Objective }>('objective_create', {
      title: 'Pai de KR',
      kind: 'okr',
    })
    const { keyResult } = call<{ keyResult: KeyResult }>('key_result_create', {
      objectiveId: objective.id,
      title: 'KR original',
    })
    const { keyResult: updated } = call<{ keyResult: KeyResult }>('key_result_update', {
      id: keyResult.id,
      title: 'KR renomeado',
      status: 'done',
    })
    expect(updated.title).toBe('KR renomeado')
    expect(updated.status).toBe('done')
    expect(notify.calls.at(-1)).toEqual([
      'objective:updated',
      { id: objective.id, keyResultId: keyResult.id },
    ])
  })
})
