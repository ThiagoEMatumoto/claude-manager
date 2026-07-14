/** @vitest-environment node */
// Unit do builder puro do contexto de feature injetado no spawn
// (--append-system-prompt-file): header + bloco tracking com o featureId real.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'feature-context-test-'))
  return {
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import { buildFeatureContextContent } from './feature-context'
import type { Feature } from '../../../shared/types/ipc'

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feat-abc-123',
    projectId: 'proj-1',
    slug: 'minha-feature',
    title: 'Minha Feature',
    status: 'in-progress',
    objective: 'Entregar a coisa',
    docPath: '/tmp/feat.md',
    synthMode: 'auto',
    model: null,
    repos: [],
    origin: 'manual',
    objectiveLinkCount: 0,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    archivedAt: null,
    body: '',
    ...overrides,
  }
}

describe('buildFeatureContextContent', () => {
  it('inclui o header da feature e o bloco tracking com o featureId real', () => {
    const content = buildFeatureContextContent(makeFeature())
    expect(content).toContain('Esta sessão trabalha na feature «Minha Feature».')
    expect(content).toContain('NÃO edite o doc manualmente')
    expect(content).toContain('Status atual: in-progress')
    expect(content).toContain('Objetivo: Entregar a coisa')
    expect(content).toContain(
      `Tracking: this session's feature id is feat-abc-123. ` +
        'Link auto-created tasks to it (parentType "feature") and update its status via ' +
        'feature_update when you finish or get blocked.',
    )
  })

  it('omite a linha de objetivo quando null e mantém o tracking', () => {
    const content = buildFeatureContextContent(makeFeature({ objective: null }))
    expect(content).not.toContain('Objetivo:')
    expect(content).toContain("Tracking: this session's feature id is feat-abc-123.")
  })

  it('anexa as seções-chave do body depois do bloco tracking', () => {
    // extractKeySections só extrai «Visão geral», «Estado atual», «Pontos em aberto».
    const body = '## Visão geral\n\nDetalhe importante da feature.\n'
    const content = buildFeatureContextContent(makeFeature({ body }))
    const trackingIdx = content.indexOf('Tracking:')
    const sectionIdx = content.indexOf('Detalhe importante da feature.')
    expect(trackingIdx).toBeGreaterThan(-1)
    expect(sectionIdx).toBeGreaterThan(trackingIdx)
  })

  it('sem OKR linkado (default []): avisa e sugere feature_set_objective_links', () => {
    const content = buildFeatureContextContent(makeFeature())
    expect(content).toContain('ainda não está sob nenhum OKR')
    expect(content).toContain('feature_set_objective_links')
  })

  it('com 1 OKR linkado: menciona o título no singular', () => {
    const content = buildFeatureContextContent(makeFeature(), ['Lançar o MCP'])
    expect(content).toContain('Esta feature serve o OKR «Lançar o MCP».')
  })

  it('com 2+ OKRs linkados: menciona todos no plural', () => {
    const content = buildFeatureContextContent(makeFeature(), ['OKR A', 'OKR B'])
    expect(content).toContain('Esta feature serve os OKRs: «OKR A», «OKR B».')
  })
})
