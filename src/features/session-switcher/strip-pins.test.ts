import { describe, it, expect } from 'vitest'
import { orderSessions, prunePinnedIds, sanitizePinnedIds, togglePinnedId } from './strip-pins'

const s = (id: string) => ({ id })

describe('sanitizePinnedIds', () => {
  it('aceita array de strings e preserva a ordem', () => {
    expect(sanitizePinnedIds(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('não-array ou lixo → vazio', () => {
    expect(sanitizePinnedIds(null)).toEqual([])
    expect(sanitizePinnedIds(undefined)).toEqual([])
    expect(sanitizePinnedIds('a')).toEqual([])
    expect(sanitizePinnedIds({ 0: 'a' })).toEqual([])
  })

  it('descarta não-strings, vazios e duplicatas mantendo a primeira ocorrência', () => {
    expect(sanitizePinnedIds(['a', 1, '', null, 'b', 'a'])).toEqual(['a', 'b'])
  })
})

describe('prunePinnedIds', () => {
  it('remove pins de sessões que não existem mais', () => {
    expect(prunePinnedIds(['a', 'dead', 'b'], new Set(['a', 'b', 'c']))).toEqual(['a', 'b'])
  })

  it('retorna o MESMO array quando nada muda (skip de persistência)', () => {
    const pins = ['a', 'b']
    expect(prunePinnedIds(pins, new Set(['a', 'b']))).toBe(pins)
  })

  it('todos mortos → vazio', () => {
    expect(prunePinnedIds(['x', 'y'], new Set())).toEqual([])
  })
})

describe('togglePinnedId', () => {
  it('adiciona ao final quando não fixado (ordem de fixação)', () => {
    expect(togglePinnedId(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('remove quando já fixado, sem mexer nos demais', () => {
    expect(togglePinnedId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('não muta o array original', () => {
    const pins = ['a']
    togglePinnedId(pins, 'b')
    expect(pins).toEqual(['a'])
  })
})

describe('orderSessions', () => {
  it('fixados primeiro na ordem de fixação; resto mantém ordem original', () => {
    const sessions = [s('a'), s('b'), s('c'), s('d')]
    expect(orderSessions(sessions, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('sem pins → mesma referência (sem re-render à toa)', () => {
    const sessions = [s('a'), s('b')]
    expect(orderSessions(sessions, [])).toBe(sessions)
  })

  it('pins de sessões ausentes são ignorados na ordenação', () => {
    const sessions = [s('a'), s('b')]
    expect(orderSessions(sessions, ['dead', 'b']).map((x) => x.id)).toEqual(['b', 'a'])
    expect(orderSessions(sessions, ['dead'])).toBe(sessions)
  })

  it('sem auto-reorder: ordem dos não-fixados nunca depende de status', () => {
    const sessions = [
      { id: 'a', status: 'idle' },
      { id: 'b', status: 'waiting' },
      { id: 'c', status: 'working' },
    ]
    expect(orderSessions(sessions, []).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})
