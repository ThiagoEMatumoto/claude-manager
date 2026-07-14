/** @vitest-environment node */
// Integração do auto-sugerir de vínculo a objetivo (Onda 2): score alto grava
// o feature_link direto; score médio grava um sinal "needs-review" (task
// tagueada) em vez de link silencioso; score baixo não faz nada. Mesma
// estratégia de setup de mcp/tools.test.ts — DB real (tmp dir), electron mockado.
import { rmSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'feature-memory-test-'))
  return {
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import { app } from 'electron'
import { closeDb, getDb } from './db'
import { create as createFeature, get as getFeature, listObjectiveLinks } from './feature-store'
import { create as createObjective, createKeyResult } from './objective-store'
import { list as listTasks } from './task-store'
import { maybeSuggestObjectiveLink } from './feature-memory'

afterAll(() => {
  closeDb()
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

beforeEach(() => {
  getDb().exec(
    'DELETE FROM feature_links; DELETE FROM tasks; DELETE FROM key_results; DELETE FROM objectives; DELETE FROM features; DELETE FROM projects;',
  )
  getDb()
    .prepare('INSERT OR IGNORE INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('proj-1', 'Projeto de teste', Date.now(), Date.now())
})

const PROMPT = 'arruma o cache de sessao do checkout'
const TITLE_HIGH = 'arruma o cache de sessao' // substring do prompt -> fuzzyScore 1
const TITLE_MEDIUM = 'cache sessao pagamento cartao externo' // overlap parcial -> ~0.4
const TITLE_LOW = 'auditoria financeira anual relatorio' // sem overlap -> 0

function makeFeature(title = 'Feature sem OKR') {
  return createFeature({ projectId: 'proj-1', title })
}

describe('maybeSuggestObjectiveLink', () => {
  it('score alto: grava o feature_link automaticamente', () => {
    const feature = makeFeature()
    const objective = createObjective({ title: TITLE_HIGH, kind: 'okr' })

    maybeSuggestObjectiveLink(feature.id, PROMPT)

    const links = listObjectiveLinks(feature.id)
    expect(links).toEqual([{ targetType: 'objective', targetId: objective.id }])
    expect(getFeature(feature.id)?.objectiveLinkCount).toBe(1)
    expect(listTasks().filter((t) => t.tags.includes('needs-review'))).toHaveLength(0)
  })

  it('score médio: NÃO grava link, cria task needs-review linkada à feature', () => {
    const feature = makeFeature()
    createObjective({ title: TITLE_MEDIUM, kind: 'okr' })

    maybeSuggestObjectiveLink(feature.id, PROMPT)

    expect(listObjectiveLinks(feature.id)).toEqual([])
    const reviewTasks = listTasks().filter((t) => t.tags.includes('needs-review'))
    expect(reviewTasks).toHaveLength(1)
    expect(reviewTasks[0].origin).toBe('auto')
    expect(reviewTasks[0].links).toEqual([{ parentType: 'feature', parentId: feature.id }])
  })

  it('score baixo: não grava link nem cria task (nunca silencioso, nunca ruído)', () => {
    const feature = makeFeature()
    createObjective({ title: TITLE_LOW, kind: 'okr' })

    maybeSuggestObjectiveLink(feature.id, PROMPT)

    expect(listObjectiveLinks(feature.id)).toEqual([])
    expect(listTasks()).toHaveLength(0)
  })

  it('considera KRs ativos, não só objetivos', () => {
    const feature = makeFeature()
    const objective = createObjective({ title: 'Objetivo genérico sem overlap', kind: 'okr' })
    const kr = createKeyResult({ objectiveId: objective.id, title: TITLE_HIGH })

    maybeSuggestObjectiveLink(feature.id, PROMPT)

    expect(listObjectiveLinks(feature.id)).toEqual([{ targetType: 'key_result', targetId: kr.id }])
  })

  it('feature já linkada (objectiveLinkCount > 0) não é candidata — guarda contra sobrescrever escolha humana', () => {
    const feature = makeFeature()
    const objective = createObjective({ title: 'Objetivo qualquer', kind: 'okr' })
    const highMatch = createObjective({ title: TITLE_HIGH, kind: 'okr' })
    // Vínculo manual pré-existente.
    getDb()
      .prepare('INSERT INTO feature_links (feature_id, target_type, target_id) VALUES (?, ?, ?)')
      .run(feature.id, 'objective', objective.id)

    maybeSuggestObjectiveLink(feature.id, PROMPT)

    // Nenhum vínculo novo pro objetivo de score alto — só o manual permanece.
    expect(listObjectiveLinks(feature.id)).toEqual([{ targetType: 'objective', targetId: objective.id }])
    expect(listObjectiveLinks(feature.id).some((l) => l.targetId === highMatch.id)).toBe(false)
  })

  it('sem prompt (sessão sem 1º prompt de usuário): não faz nada', () => {
    const feature = makeFeature()
    createObjective({ title: TITLE_HIGH, kind: 'okr' })

    maybeSuggestObjectiveLink(feature.id, null)

    expect(listObjectiveLinks(feature.id)).toEqual([])
  })
})
