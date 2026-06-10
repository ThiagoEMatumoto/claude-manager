import { describe, expect, it } from 'vitest'
import { isDraftFeature, isListedFeature } from './feature-visibility'

describe('isDraftFeature', () => {
  it('auto-criada sem registros é rascunho', () => {
    expect(isDraftFeature('auto', 0)).toBe(true)
  })

  it('auto-criada com 1+ registros deixa de ser rascunho', () => {
    expect(isDraftFeature('auto', 1)).toBe(false)
    expect(isDraftFeature('auto', 5)).toBe(false)
  })

  it('manual nunca é rascunho, mesmo sem registros', () => {
    expect(isDraftFeature('manual', 0)).toBe(false)
    expect(isDraftFeature('manual', 3)).toBe(false)
  })
})

describe('isListedFeature', () => {
  it('manual sem registros aparece (não é rascunho)', () => {
    expect(isListedFeature('manual', 0, null)).toBe(true)
  })

  it('rascunho fica fora da listagem padrão', () => {
    expect(isListedFeature('auto', 0, null)).toBe(false)
  })

  it('auto com registro aparece', () => {
    expect(isListedFeature('auto', 1, null)).toBe(true)
  })

  it('arquivada fica fora independente de origin/registros', () => {
    expect(isListedFeature('manual', 4, 123)).toBe(false)
    expect(isListedFeature('auto', 0, 123)).toBe(false)
  })
})
