import { describe, expect, it } from 'vitest'
import { composeHandoffPrompt, type HandoffEdge } from './compose-prompt'

describe('composeHandoffPrompt', () => {
  const edges: HandoffEdge[] = [
    { kind: 'calls-api', label: null, direction: 'from-mother' },
    { kind: 'shares-types', label: null, direction: 'to-mother' },
  ]

  const prompt = composeHandoffPrompt({
    targetRepoLabel: 'backend',
    targetRepoPath: '/repos/backend',
    motherRepoLabel: 'frontend',
    task: 'Adicionar endpoint de health-check',
    edges,
    featureTitle: 'Observabilidade',
    handoffId: 'h-123',
  })

  it('contém as 4 seções do template', () => {
    expect(prompt).toContain('## Contexto')
    expect(prompt).toContain('## Tarefa')
    expect(prompt).toContain('## Restrições')
    expect(prompt).toContain('## Reporte')
  })

  it('inclui a task e o featureTitle', () => {
    expect(prompt).toContain('Adicionar endpoint de health-check')
    expect(prompt).toContain('Observabilidade')
  })

  it('descreve cada kind com a frase natural correta', () => {
    expect(prompt).toContain('consome a API') // calls-api
    expect(prompt).toContain('compartilha tipos') // shares-types
  })

  it('orienta a frase pela direção da aresta', () => {
    // from-mother: mãe é o sujeito
    expect(prompt).toContain('o repo frontend consome a API este repo (backend)')
    // to-mother: este repo é o sujeito
    expect(prompt).toContain('este repo (backend) compartilha tipos o repo frontend')
  })

  it('embute o handoffId na instrução de handoff_report e o cap 250', () => {
    expect(prompt).toContain('handoff_report')
    expect(prompt).toContain('handoffId="h-123"')
    expect(prompt).toContain('250')
  })

  it('lista o repo alvo e seu path nas restrições', () => {
    expect(prompt).toContain('SOMENTE neste repo (backend, /repos/backend)')
  })

  it('kind desconhecido cai no genérico "se relaciona com"', () => {
    const p = composeHandoffPrompt({
      targetRepoLabel: 'svc',
      targetRepoPath: '/repos/svc',
      task: 't',
      edges: [{ kind: 'whatever', label: null, direction: 'from-mother' }],
      handoffId: 'h-x',
    })
    expect(p).toContain('se relaciona com')
  })
})
