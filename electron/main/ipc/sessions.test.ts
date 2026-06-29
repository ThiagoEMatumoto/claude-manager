/** @vitest-environment node */
// Unit das funções puras extraídas do handler de spawn:
//  - formatPtyInjection: bracketed-paste correto + \r final, multi-linha íntegra.
//  - buildSpawnInnerCmd: montagem das flags (--append-system-prompt-file, --model,
//    --session-id, mcpConfigArg) sem I/O.
import { describe, expect, it, vi } from 'vitest'

// sessions.ts importa electron + módulos de serviço no topo. O teste só exercita
// as funções puras, então mockamos as dependências de I/O pra o import não tocar
// db/pty/mcp reais.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cm-test-userdata' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => {} },
}))
vi.mock('../services/db', () => ({ getDb: () => ({}) }))
vi.mock('../services/pty-manager', () => ({
  ptyManager: { on: () => {}, off: () => {}, write: () => {} },
}))
vi.mock('../services/feature-store', () => ({ get: () => null }))
vi.mock('../services/feature-memory', () => ({ featureMemory: {} }))
vi.mock('../services/mcp/server', () => ({ getMcpRuntime: () => null }))
vi.mock('../services/mcp/config', () => ({ mcpClientConfigPath: () => '/tmp/mcp.json' }))
vi.mock('../services/session-activity', () => ({
  sessionActivityService: {},
  findTranscriptPath: () => null,
  buildSessionsFileIndex: () => new Map(),
  readTranscriptTitle: () => null,
  readTail: () => null,
  deriveEnrichment: () => ({}),
  isPidAlive: () => false,
  mapStatus: () => 'idle',
}))

import { formatPtyInjection, buildSpawnInnerCmd } from './sessions'

describe('formatPtyInjection', () => {
  const START = '\x1b[200~'
  const END = '\x1b[201~'

  it('envelopa em bracketed-paste e termina com \\r', () => {
    const out = formatPtyInjection('hello')
    expect(out).toBe(`${START}hello${END}\r`)
    expect(out.startsWith(START)).toBe(true)
    expect(out.endsWith(`${END}\r`)).toBe(true)
  })

  it('preserva conteúdo multi-linha sem \\r entre as linhas internas', () => {
    const cmd = ['## Contexto', 'linha 1', '', 'linha 2'].join('\n')
    const out = formatPtyInjection(cmd)
    // O único Enter (\r) é o final; as quebras internas continuam \n.
    expect(out).toBe(`${START}${cmd}${END}\r`)
    expect((out.match(/\r/g) ?? []).length).toBe(1)
    expect(out.includes('## Contexto\nlinha 1\n\nlinha 2')).toBe(true)
  })
})

describe('buildSpawnInnerCmd', () => {
  const base = {
    claudeCmd: 'claude',
    sessionId: '11111111-1111-1111-1111-111111111111',
    name: 'meu repo',
    mcpConfigArg: ' --mcp-config /tmp/mcp.json',
    model: null as string | null,
    systemPromptFilePath: null as string | null,
  }

  it('inclui --session-id, -n quotado e o mcpConfigArg', () => {
    const cmd = buildSpawnInnerCmd(base)
    expect(cmd).toContain('--session-id 11111111-1111-1111-1111-111111111111')
    expect(cmd).toContain("-n 'meu repo'")
    expect(cmd).toContain('--mcp-config /tmp/mcp.json')
  })

  it('anexa --append-system-prompt-file <path quotado> quando há system-prompt-file', () => {
    const cmd = buildSpawnInnerCmd({ ...base, systemPromptFilePath: '/tmp/cm/handoff-1.md' })
    expect(cmd).toContain("--append-system-prompt-file '/tmp/cm/handoff-1.md'")
  })

  it('NÃO inclui --append-system-prompt-file quando não há path', () => {
    const cmd = buildSpawnInnerCmd(base)
    expect(cmd).not.toContain('--append-system-prompt-file')
  })

  it('anexa --model quando há modelo (já validado)', () => {
    const cmd = buildSpawnInnerCmd({ ...base, model: 'opus' })
    expect(cmd).toContain("--model 'opus'")
  })

  it('NÃO inclui --model quando o modelo é null', () => {
    const cmd = buildSpawnInnerCmd(base)
    expect(cmd).not.toContain('--model')
  })

  it('anexa --effort quando há nível (já validado)', () => {
    const cmd = buildSpawnInnerCmd({ ...base, effort: 'high' })
    expect(cmd).toContain("--effort 'high'")
  })

  it('NÃO inclui --effort quando o nível é null/ausente', () => {
    expect(buildSpawnInnerCmd({ ...base, effort: null })).not.toContain('--effort')
    expect(buildSpawnInnerCmd(base)).not.toContain('--effort')
  })

  it('anexa --permission-mode quando passado (handoff plan/auto-edits)', () => {
    expect(buildSpawnInnerCmd({ ...base, permissionMode: 'plan' })).toContain(
      "--permission-mode 'plan'",
    )
    expect(buildSpawnInnerCmd({ ...base, permissionMode: 'acceptEdits' })).toContain(
      "--permission-mode 'acceptEdits'",
    )
  })

  it('NÃO inclui --permission-mode quando ausente (comportamento legado)', () => {
    expect(buildSpawnInnerCmd(base)).not.toContain('--permission-mode')
  })

  it('anexa --disallowedTools com cada spec quotado (denylist destrutivo)', () => {
    const cmd = buildSpawnInnerCmd({
      ...base,
      disallowedTools: ['Bash(rm:*)', 'Bash(git push:*)'],
    })
    expect(cmd).toContain("--disallowedTools 'Bash(rm:*)' 'Bash(git push:*)'")
  })

  it('NÃO inclui --disallowedTools quando a lista é vazia/ausente', () => {
    expect(buildSpawnInnerCmd({ ...base, disallowedTools: [] })).not.toContain('--disallowedTools')
    expect(buildSpawnInnerCmd(base)).not.toContain('--disallowedTools')
  })
})
