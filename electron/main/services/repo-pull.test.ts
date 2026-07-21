import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

// repo-pull importa db/notify/git-auth, que tocam electron no topo. Mockamos o
// mínimo; classifyPullEligibility é puro e não usa nada disso.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { classifyPullEligibility, deriveOverallStatus } from './repo-pull'

describe('classifyPullEligibility', () => {
  it('dirty quando há arquivos na working tree', () => {
    expect(classifyPullEligibility({ ahead: 0, files: [{}] })).toBe('dirty')
  })

  it('dirty tem prioridade sobre diverged', () => {
    expect(classifyPullEligibility({ ahead: 3, files: [{}, {}] })).toBe('dirty')
  })

  it('diverged quando há commits locais adiante e a tree está limpa', () => {
    expect(classifyPullEligibility({ ahead: 2, files: [] })).toBe('diverged')
  })

  it('eligible quando limpo e sem commits adiante', () => {
    expect(classifyPullEligibility({ ahead: 0, files: [] })).toBe('eligible')
  })
})

describe('deriveOverallStatus', () => {
  it('skipped quando não há branches (nada foi tentado)', () => {
    expect(deriveOverallStatus([])).toEqual({ status: 'skipped', detail: undefined })
  })

  it('skipped quando todas as branches foram puladas', () => {
    const result = deriveOverallStatus([
      { branch: 'feat/x', status: 'skipped', detail: 'dirty' },
    ])
    expect(result.status).toBe('skipped')
    expect(result.detail).toBe('feat/x: skipped(dirty)')
  })

  it('up-to-date quando nada avançou mas algo estava em dia', () => {
    const result = deriveOverallStatus([
      { branch: 'main', status: 'up-to-date' },
      { branch: 'feat/x', status: 'skipped', detail: 'diverged' },
    ])
    expect(result.status).toBe('up-to-date')
  })

  it('pulled quando pelo menos uma branch avançou', () => {
    const result = deriveOverallStatus([
      { branch: 'main', status: 'pulled' },
      { branch: 'feat/x', status: 'skipped', detail: 'dirty' },
    ])
    expect(result.status).toBe('pulled')
    expect(result.detail).toBe('main: pulled · feat/x: skipped(dirty)')
  })

  it('error tem prioridade sobre pulled/up-to-date quando misto', () => {
    const result = deriveOverallStatus([
      { branch: 'main', status: 'pulled' },
      { branch: 'feat/x', status: 'error', detail: 'boom' },
    ])
    expect(result.status).toBe('error')
    expect(result.detail).toBe('main: pulled · feat/x: error(boom)')
  })
})
