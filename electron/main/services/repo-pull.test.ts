import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

// repo-pull importa db/notify/git-auth, que tocam electron no topo. Mockamos o
// mínimo; classifyPullEligibility é puro e não usa nada disso.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { classifyPullEligibility } from './repo-pull'

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
