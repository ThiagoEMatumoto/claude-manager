import { describe, expect, it } from 'vitest'
import { deriveSubagentActivity, MAX_SUBAGENTS } from './subagent-activity'

function toolUseLine(id: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Task', input: {} }] },
  })
}

function toolResultLine(toolUseId: string, isError = false): string {
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }] },
  })
}

function meta(toolUseId: string, name = `agent-${toolUseId}`) {
  return { toolUseId, name, description: `desc ${toolUseId}` }
}

describe('deriveSubagentActivity', () => {
  it('tool_use without tool_result → running', () => {
    const tail = toolUseLine('t1')
    expect(deriveSubagentActivity([meta('t1')], tail)).toEqual([
      { name: 'agent-t1', description: 'desc t1', state: 'running' },
    ])
  })

  it('tool_result present → ok / error by is_error', () => {
    const tail = [
      toolUseLine('t1'),
      toolUseLine('t2'),
      toolResultLine('t1', false),
      toolResultLine('t2', true),
    ].join('\n')
    const out = deriveSubagentActivity([meta('t1'), meta('t2')], tail)
    expect(out.find((a) => a.name === 'agent-t1')?.state).toBe('ok')
    expect(out.find((a) => a.name === 'agent-t2')?.state).toBe('error')
  })

  it('tool_result without seeing the tool_use (use fora do tail) still resolves', () => {
    const tail = toolResultLine('t1')
    expect(deriveSubagentActivity([meta('t1')], tail)[0]?.state).toBe('ok')
  })

  it('omits metas with neither tool_use nor tool_result in the tail', () => {
    const tail = toolUseLine('t1')
    const out = deriveSubagentActivity([meta('t1'), meta('old')], tail)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('agent-t1')
  })

  it('orders running first (launch order), then completed most-recent first', () => {
    const tail = [
      toolUseLine('done-old'),
      toolResultLine('done-old'),
      toolUseLine('run-a'),
      toolUseLine('done-new'),
      toolUseLine('run-b'),
      toolResultLine('done-new'),
    ].join('\n')
    const out = deriveSubagentActivity(
      [meta('done-old'), meta('run-b'), meta('done-new'), meta('run-a')],
      tail
    )
    expect(out.map((a) => a.name)).toEqual([
      'agent-run-a',
      'agent-run-b',
      'agent-done-new',
      'agent-done-old',
    ])
  })

  it(`caps the list at ${MAX_SUBAGENTS} items`, () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const tail = ids.map((id) => toolUseLine(id)).join('\n')
    const out = deriveSubagentActivity(
      ids.map((id) => meta(id)),
      tail
    )
    expect(out).toHaveLength(MAX_SUBAGENTS)
    expect(out.map((a) => a.name)).toEqual(['agent-a', 'agent-b', 'agent-c', 'agent-d'])
  })

  it('ignores broken lines and string content', () => {
    const tail = [
      '{"type":"assistant","message":{"content":[{"type":"tool_us', // linha partida
      JSON.stringify({ type: 'user', message: { content: 'texto puro' } }),
      toolUseLine('t1'),
    ].join('\n')
    expect(deriveSubagentActivity([meta('t1')], tail)).toHaveLength(1)
  })

  it('empty inputs → empty list', () => {
    expect(deriveSubagentActivity([], toolUseLine('t1'))).toEqual([])
    expect(deriveSubagentActivity([meta('t1')], '')).toEqual([])
  })
})
