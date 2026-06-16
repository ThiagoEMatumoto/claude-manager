import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countSubagentTurns } from './subagent-turns'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'subagent-turns-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeSubagentFile(sessionId: string, file: string, lines: object[]): void {
  const dir = join(root, sessionId, 'subagents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

describe('countSubagentTurns', () => {
  it('conta linhas assistant em todos os arquivos da pasta subagents/', () => {
    writeSubagentFile('sess1', 'agent-a.jsonl', [
      { type: 'assistant' },
      { type: 'user' },
      { type: 'assistant' },
    ])
    writeSubagentFile('sess1', 'agent-b.jsonl', [{ type: 'assistant' }, { type: 'system' }])
    expect(countSubagentTurns(root, 'sess1')).toBe(3)
  })

  it('retorna 0 quando a pasta subagents/ não existe (degrada, não quebra)', () => {
    expect(countSubagentTurns(root, 'no-such-session')).toBe(0)
  })

  it('retorna 0 quando a pasta existe mas não há linhas assistant', () => {
    writeSubagentFile('sess2', 'agent-a.jsonl', [{ type: 'user' }, { type: 'system' }])
    expect(countSubagentTurns(root, 'sess2')).toBe(0)
  })

  it('ignora linhas inválidas (JSON parcial) sem quebrar', () => {
    const dir = join(root, 'sess3', 'subagents')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'agent-a.jsonl'),
      '{"type":"assistant"}\n{ broken json\n{"type":"assistant"}\n',
    )
    expect(countSubagentTurns(root, 'sess3')).toBe(2)
  })
})
