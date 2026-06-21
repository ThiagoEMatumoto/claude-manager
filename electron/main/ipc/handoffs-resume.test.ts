/** @vitest-environment node */
// Gate do handler 'handoffs:resume' / 'handoffs:is-resumable' (Fase 3 — robustez
// de órfãos). Não exercita o re-spawn real (PTY/claude): captura os callbacks que
// registerSessionIpc passa a ipcMain.handle e valida os GATES de pré-condição
// (status precisa ser 'interrupted', cc_session_id válido, transcript existente).
// O caminho feliz (startSession + markRunning) é coberto pelas peças já testadas
// (handoff-store.markRunning) e pelo typecheck/build.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Handoff } from '../../../shared/types/ipc'

// Captura os handlers registrados por canal.
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cm-test-userdata' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, cb: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, cb)
    },
  },
}))

// DB falso: só responde ao SELECT de cc_session_id e ao de repos. ccRow/repoRow
// são injetáveis por teste.
let ccRow: { cc_session_id: string | null } | undefined
let repoRow: { path: string; label: string } | undefined
vi.mock('../services/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => (sql.includes('FROM sessions') ? ccRow : repoRow),
    }),
  }),
}))

vi.mock('../services/pty-manager', () => ({
  ptyManager: { on: () => {}, off: () => {}, write: () => {} },
}))
vi.mock('../services/feature-store', () => ({ get: () => null }))
vi.mock('../services/feature-memory', () => ({ featureMemory: {} }))
vi.mock('../services/mcp/server', () => ({ getMcpRuntime: () => null }))
vi.mock('../services/mcp/config', () => ({ mcpClientConfigPath: () => '/tmp/mcp.json' }))
vi.mock('../services/notify', () => ({ broadcast: () => {} }))

let transcriptPath: string | null = null
vi.mock('../services/session-activity', () => ({
  sessionActivityService: {},
  findTranscriptPath: () => transcriptPath,
  buildSessionsFileIndex: () => new Map(),
  readTranscriptTitle: () => null,
  readTail: () => null,
  deriveEnrichment: () => ({}),
  isPidAlive: () => false,
  mapStatus: () => 'idle',
}))

let handoff: Handoff | null = null
vi.mock('../services/handoff-store', () => ({
  get: () => handoff,
  markRunning: vi.fn((_id: string, childSessionId: string) => ({
    ...(handoff as Handoff),
    status: 'running',
    childSessionId,
  })),
}))

import { registerSessionIpc } from './sessions'
import * as handoffStore from '../services/handoff-store'
const markRunning = vi.mocked(handoffStore.markRunning)

function baseHandoff(over: Partial<Handoff> = {}): Handoff {
  return {
    id: 'h1',
    motherSessionId: null,
    targetRepoId: 'r1',
    targetRepoLabel: 'Repo 1',
    childSessionId: 'child-internal-1',
    featureId: null,
    task: 't',
    contextJson: null,
    composedPrompt: 'p',
    status: 'interrupted',
    mode: 'interactive',
    currentStep: null,
    stepUpdatedAt: null,
    pendingQuestion: null,
    questionAskedAt: null,
    summary: null,
    error: 'Sessão-filha encerrada sem reportar conclusão',
    createdAt: 1,
    updatedAt: 1,
    consumedAt: null,
    fromRepoId: null,
    outcome: null,
    ...over,
  }
}

const VALID_CC = '11111111-2222-3333-4444-555555555555'

describe('handoffs:resume / handoffs:is-resumable gates', () => {
  beforeEach(() => {
    handlers.clear()
    markRunning.mockClear()
    handoff = null
    ccRow = undefined
    repoRow = undefined
    transcriptPath = null
    registerSessionIpc()
  })

  function resume(id = 'h1') {
    return handlers.get('handoffs:resume')!(null, id)
  }
  function isResumable(id = 'h1'): boolean {
    return handlers.get('handoffs:is-resumable')!(null, id) as boolean
  }

  it('rejeita resume quando o handoff não está interrompido', () => {
    handoff = baseHandoff({ status: 'running' })
    expect(() => resume()).toThrow(/interrompido/)
    expect(markRunning).not.toHaveBeenCalled()
  })

  it('rejeita resume quando não há cc_session_id válido', () => {
    handoff = baseHandoff()
    ccRow = { cc_session_id: null }
    expect(() => resume()).toThrow(/cc_session_id/)
  })

  it('rejeita resume quando o transcript não existe (não-resumível)', () => {
    handoff = baseHandoff()
    ccRow = { cc_session_id: VALID_CC }
    transcriptPath = null
    expect(() => resume()).toThrow(/transcript/)
  })

  it('is-resumable: false quando não interrompido; true quando interrompido + transcript', () => {
    handoff = baseHandoff({ status: 'failed' })
    ccRow = { cc_session_id: VALID_CC }
    transcriptPath = '/tmp/t.jsonl'
    expect(isResumable()).toBe(false)

    handoff = baseHandoff() // interrupted
    expect(isResumable()).toBe(true)

    transcriptPath = null
    expect(isResumable()).toBe(false)
  })
})
