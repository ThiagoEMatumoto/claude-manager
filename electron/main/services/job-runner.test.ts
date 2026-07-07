import { describe, expect, it, vi } from 'vitest'

// job-runner importa claude-cli/scheduled-job-store, que puxam './db' (electron no
// topo). Mockamos './db' pra o import não tocar electron; o teste injeta TODAS as
// deps (runJson/updateRun/resolveCwd/now), então nada real de claude/db/fs roda.
vi.mock('./db', () => ({ getDb: () => ({}) }))

import { runJob, buildHeadlessArgs, type JobRunParams, type ClaudeHeadlessResult } from './job-runner'
import type { RunResult } from './claude-cli'

function baseParams(over: Partial<JobRunParams> = {}): JobRunParams {
  return {
    repoId: null,
    prompt: 'audite as extrações',
    runId: 'run-1',
    ccSessionId: 'cc-123',
    ...over,
  }
}

// Stub do runClaudeJson: devolve o par {data, result} pronto (sem tocar claude).
function stubJson(data: ClaudeHeadlessResult | null, code = 0, stderr = '') {
  return async () => ({ data, result: { stdout: '', stderr, code } as RunResult })
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

describe('buildHeadlessArgs', () => {
  it('monta -p com kickoff posicional + session-id + json + default mode', () => {
    const args = buildHeadlessArgs(baseParams())
    expect(args[0]).toBe('-p')
    expect(typeof args[1]).toBe('string') // kickoff posicional
    expect(argValue(args, '--session-id')).toBe('cc-123')
    expect(argValue(args, '--output-format')).toBe('json')
    // sem permissionMode explícito → default 'default' (observe-only; a crítica vai
    // direto pro stdout, sem desviar pro ExitPlanMode indisponível em headless).
    expect(argValue(args, '--permission-mode')).toBe('default')
  })

  it('inclui --model/--effort só na whitelist + --append-system-prompt', () => {
    const args = buildHeadlessArgs(
      baseParams({ model: 'opus', effort: 'high', systemPrompt: 'SP', permissionMode: 'plan' }),
    )
    expect(argValue(args, '--model')).toBe('opus')
    expect(argValue(args, '--effort')).toBe('high')
    expect(argValue(args, '--append-system-prompt')).toBe('SP')
  })

  it('descarta model fora da whitelist (defense-in-depth)', () => {
    const args = buildHeadlessArgs(baseParams({ model: 'gpt-4' as unknown as string }))
    expect(args).not.toContain('--model')
  })

  it('SEMPRE aplica o denylist destrutivo + read-only lockdown (job sem supervisão)', () => {
    // Job observe-only em default recebe o guard-rail completo: destrutivo do Bash E
    // bloqueio de TODA escrita de arquivo (o job lê/analisa mas não modifica nada).
    const args = buildHeadlessArgs(baseParams())
    const i = args.indexOf('--disallowedTools')
    expect(i).toBeGreaterThan(-1)
    const specs = args.slice(i + 1)
    expect(specs).toContain('Bash(rm:*)')
    // read-only lockdown: nenhuma tool de escrita de arquivo.
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(specs).toContain(tool)
    }
  })

  it('mescla o denylist do renderer com o destrutivo/lockdown (sem enfraquecer)', () => {
    const args = buildHeadlessArgs(baseParams({ disallowedTools: ['Custom(x)'] }))
    const i = args.indexOf('--disallowedTools')
    const specs = args.slice(i + 1)
    expect(specs).toContain('Custom(x)')
    expect(specs).toContain('Bash(rm:*)')
    expect(specs).toContain('Write')
    expect(specs).toContain('Edit')
  })
})

describe('runJob (finalização async)', () => {
  it('exit 0 com .result → success + report_text + capture_quality full + tokens', async () => {
    const updateRun = vi.fn()
    await runJob(baseParams(), {
      runJson: stubJson({
        result: '## Relatório\n- ok',
        is_error: false,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      updateRun,
      resolveCwd: () => '/tmp',
      now: () => 42,
    })
    expect(updateRun).toHaveBeenCalledTimes(1)
    expect(updateRun.mock.calls[0]![0]).toMatchObject({
      id: 'run-1',
      status: 'success',
      reportText: '## Relatório\n- ok',
      captureQuality: 'full',
      tokens: 120,
      finishedAt: 42,
      error: null,
    })
  })

  it('exit ≠ 0 → failed com stderr no error', async () => {
    const updateRun = vi.fn()
    await runJob(baseParams(), {
      runJson: stubJson(null, 1, 'boom'),
      updateRun,
      resolveCwd: () => '/tmp',
      now: () => 7,
    })
    expect(updateRun.mock.calls[0]![0]).toMatchObject({ id: 'run-1', status: 'failed', error: 'boom' })
  })

  it('is_error true mesmo com exit 0 → failed', async () => {
    const updateRun = vi.fn()
    await runJob(baseParams(), {
      runJson: stubJson({ result: 'x', is_error: true }, 0),
      updateRun,
      resolveCwd: () => '/tmp',
      now: () => 1,
    })
    expect(updateRun.mock.calls[0]![0].status).toBe('failed')
  })

  it('resolveCwd que lança → failed (a run NUNCA fica presa em running)', async () => {
    const updateRun = vi.fn()
    await runJob(baseParams({ repoId: 'gone' }), {
      runJson: stubJson({ result: 'x' }),
      updateRun,
      resolveCwd: () => {
        throw new Error('repo not found: gone')
      },
      now: () => 9,
    })
    const arg = updateRun.mock.calls[0]![0]
    expect(arg).toMatchObject({ id: 'run-1', status: 'failed' })
    expect(String(arg.error)).toContain('repo not found')
  })

  it('exit 0 sem texto → success com capture_quality none', async () => {
    const updateRun = vi.fn()
    await runJob(baseParams(), {
      runJson: stubJson({ result: '', is_error: false }),
      updateRun,
      resolveCwd: () => '/tmp',
      now: () => 3,
    })
    expect(updateRun.mock.calls[0]![0]).toMatchObject({ status: 'success', captureQuality: 'none' })
  })

  it('guard fail-closed: permissionMode autônomo → failed SEM spawnar', async () => {
    const updateRun = vi.fn()
    const runJson = vi.fn(stubJson({ result: 'x' }))
    await runJob(baseParams({ permissionMode: 'bypassPermissions' }), {
      runJson,
      updateRun,
      resolveCwd: () => '/tmp',
      now: () => 5,
    })
    // Nunca spawnou o claude — o guard finaliza antes de resolver cwd/args.
    expect(runJson).not.toHaveBeenCalled()
    const arg = updateRun.mock.calls[0]![0]
    expect(arg).toMatchObject({ id: 'run-1', status: 'failed', finishedAt: 5 })
    expect(String(arg.error)).toContain('observe-only')
  })

  it('sem runId → no-op (nada a finalizar)', async () => {
    const updateRun = vi.fn()
    await runJob(baseParams({ runId: null }), {
      runJson: stubJson({ result: 'x' }),
      updateRun,
      resolveCwd: () => '/tmp',
    })
    expect(updateRun).not.toHaveBeenCalled()
  })
})
