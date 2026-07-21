/** @vitest-environment node */
// Gate do handler 'dossiers:approveGateA'/'approveGateB'/'resumeRun': quando a
// pipeline relança um erro de estágio (extract/verify/synth via claude -p), a
// run já foi persistida como 'failed' com error preenchido (dossier-pipeline.ts).
// O handler IPC precisa absorver essa rejeição e devolver a run 'failed' já
// atualizada — nunca deixar a exceção escapar sem que a run fique visível pra
// UI. Rejeições que NÃO deixam a run em 'failed' (ex.: throttle de fetch) devem
// continuar propagando normalmente.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DossierRun } from '../../../shared/types/ipc'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, cb: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, cb)
    },
  },
}))

const broadcastCalls: unknown[] = []
vi.mock('../services/notify', () => ({
  broadcast: (...args: unknown[]) => broadcastCalls.push(args),
}))

let getRunResult: DossierRun | null = null
vi.mock('../services/dossier-store', () => ({
  getRun: () => getRunResult,
}))

let approveGateAImpl: () => Promise<DossierRun>
vi.mock('../services/dossier-pipeline-singleton', () => ({
  getDossierPipeline: () => ({
    approveGateA: () => approveGateAImpl(),
  }),
  isWebSearchEnabled: () => true,
}))

import { registerDossiersIpc } from './dossiers'

function baseRun(overrides: Partial<DossierRun>): DossierRun {
  return {
    id: 'run-1',
    dossierId: 'dossier-1',
    status: 'extracting',
    stage: 'extracting',
    planJson: null,
    checkpointJson: null,
    costTokens: 0,
    summary: null,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    ...overrides,
  }
}

describe('dossiers ipc — runPipelineStep', () => {
  beforeEach(() => {
    handlers.clear()
    broadcastCalls.length = 0
    getRunResult = null
    registerDossiersIpc()
  })

  it('estágio falha e run já foi persistida como failed: handler resolve com a run failed (sem exceção não-tratada)', async () => {
    approveGateAImpl = () => Promise.reject(new Error('claude -p exited with code 1'))
    getRunResult = baseRun({ status: 'failed', error: 'claude -p exited with code 1' })

    const handler = handlers.get('dossiers:approveGateA')!
    const result = (await handler(null, { runId: 'run-1' })) as DossierRun

    expect(result.status).toBe('failed')
    expect(result.error).toBe('claude -p exited with code 1')
    expect(broadcastCalls).toHaveLength(1)
    expect(broadcastCalls[0]).toEqual(['dossier:run-updated', result])
  })

  it('rejeição sem persistir failed (ex.: throttle de fetch) continua propagando', async () => {
    approveGateAImpl = () => Promise.reject(new Error('stub fetch throttled'))
    getRunResult = baseRun({ status: 'fetching', error: null })

    const handler = handlers.get('dossiers:approveGateA')!
    await expect(handler(null, { runId: 'run-1' })).rejects.toThrow('stub fetch throttled')
    expect(broadcastCalls).toHaveLength(0)
  })
})
