import { describe, expect, it, vi } from 'vitest'

// O módulo importa `ipcMain` de 'electron' no top-level — mockamos pra poder
// importar só o schema de contrato num ambiente Node.
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { repoDependencyKind } from './repo-dependencies'

describe('repoDependencyKind schema', () => {
  it('aceita os 4 kinds novos da Wave A', () => {
    for (const kind of ['work-hub', 'infra', 'monorepo', 'documents']) {
      expect(repoDependencyKind.safeParse(kind).success).toBe(true)
    }
  })

  it('continua aceitando os kinds originais e custom', () => {
    for (const kind of ['calls-api', 'shares-types', 'depends-on', 'deploys-to', 'custom']) {
      expect(repoDependencyKind.safeParse(kind).success).toBe(true)
    }
  })

  it('rejeita kind desconhecido', () => {
    expect(repoDependencyKind.safeParse('whatever').success).toBe(false)
  })
})
