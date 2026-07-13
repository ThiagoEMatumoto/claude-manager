import { describe, it, expect } from 'vitest'
import { validateKeybindingsContent } from './claude-keybindings'

describe('validateKeybindingsContent', () => {
  it('aceita objeto JSON válido', () => {
    expect(() => validateKeybindingsContent('{ "keybindings": [] }')).not.toThrow()
    expect(() => validateKeybindingsContent('{}')).not.toThrow()
  })

  it('rejeita JSON malformado com mensagem de parse', () => {
    expect(() => validateKeybindingsContent('{ oops }')).toThrow(/JSON inválido/)
    expect(() => validateKeybindingsContent('')).toThrow(/JSON inválido/)
  })

  it('rejeita raiz que não é objeto', () => {
    expect(() => validateKeybindingsContent('[]')).toThrow(/objeto/)
    expect(() => validateKeybindingsContent('"str"')).toThrow(/objeto/)
    expect(() => validateKeybindingsContent('null')).toThrow(/objeto/)
  })

  it('rejeita conteúdo acima do teto de 256KB', () => {
    const big = `{ "x": "${'a'.repeat(256 * 1024)}" }`
    expect(() => validateKeybindingsContent(big)).toThrow(/grande/)
  })
})
