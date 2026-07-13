import { describe, it, expect } from 'vitest'
import { insertHookEntryAt, removeHookEntryAt, summarizeHookEntry } from './claude-hooks'

const ENTRY_A = { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'a.sh' }] }
const ENTRY_B = { hooks: [{ type: 'command', command: 'b.sh' }] }

function settingsWith(hooks: Record<string, unknown>) {
  return { model: 'opus', env: { X: '1' }, hooks }
}

describe('removeHookEntryAt', () => {
  it('remove a entry certa e preserva o resto do arquivo', () => {
    const current = settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B], Stop: [ENTRY_B] })
    const { next, removed } = removeHookEntryAt(current, 'PreToolUse', 0)
    expect(removed).toEqual(ENTRY_A)
    expect(next.hooks).toEqual({ PreToolUse: [ENTRY_B], Stop: [ENTRY_B] })
    expect(next.model).toBe('opus')
    expect(next.env).toEqual({ X: '1' })
    // Imutável: original intacto.
    expect((current.hooks as Record<string, unknown[]>).PreToolUse).toHaveLength(2)
  })

  it('evento que fica vazio é removido do map', () => {
    const { next } = removeHookEntryAt(settingsWith({ Stop: [ENTRY_A] }), 'Stop', 0)
    expect('hooks' in next).toBe(false)
  })

  it('lança em evento/índice inexistente', () => {
    const current = settingsWith({ Stop: [ENTRY_A] })
    expect(() => removeHookEntryAt(current, 'PreToolUse', 0)).toThrow()
    expect(() => removeHookEntryAt(current, 'Stop', 1)).toThrow()
    expect(() => removeHookEntryAt({}, 'Stop', 0)).toThrow()
  })
})

describe('insertHookEntryAt', () => {
  it('round-trip: remover e re-inserir na posição original restaura o arquivo', () => {
    const original = settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B], Stop: [ENTRY_B] })
    const { next, removed } = removeHookEntryAt(original, 'PreToolUse', 0)
    const restored = insertHookEntryAt(next, 'PreToolUse', 0, removed)
    expect(restored).toEqual(original)
  })

  it('round-trip recria evento (e chave hooks) removidos por ficarem vazios', () => {
    const original = settingsWith({ Stop: [ENTRY_A] })
    const { next, removed } = removeHookEntryAt(original, 'Stop', 0)
    const restored = insertHookEntryAt(next, 'Stop', 0, removed)
    expect(restored).toEqual(original)
  })

  it('clampa posição além do tamanho atual (array encolheu enquanto desligado)', () => {
    const restored = insertHookEntryAt(settingsWith({ Stop: [ENTRY_B] }), 'Stop', 5, ENTRY_A)
    expect(restored.hooks).toEqual({ Stop: [ENTRY_B, ENTRY_A] })
  })
})

describe('summarizeHookEntry', () => {
  it('extrai matcher e comandos', () => {
    expect(summarizeHookEntry(ENTRY_A)).toEqual({ matcher: 'Edit|Write', summary: 'a.sh' })
  })

  it('entry sem matcher → matcher null', () => {
    expect(summarizeHookEntry(ENTRY_B).matcher).toBeNull()
  })

  it('entry malformada não lança', () => {
    expect(summarizeHookEntry(null).summary).toBe('entry inválida')
    expect(summarizeHookEntry({ hooks: 'x' }).summary).toContain('0 hook(s)')
  })
})
