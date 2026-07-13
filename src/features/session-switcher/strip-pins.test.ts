import { describe, it, expect } from 'vitest'
import {
  mergePinnedIds,
  orderSessions,
  prunePinnedIdsWithGrace,
  sanitizePinnedIds,
  togglePinnedId,
} from './strip-pins'

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

describe('prunePinnedIdsWithGrace', () => {
  const none: ReadonlySet<string> = new Set()

  it('1ª ausência só marca a carência, não remove (snapshot pode estar parcial)', () => {
    const pins = ['a', 'dead']
    const r = prunePinnedIdsWithGrace(pins, new Set(['a']), none, none)
    expect(r.pinnedIds).toBe(pins)
    expect(r.missing).toEqual(new Set(['dead']))
  })

  it('2ª ausência consecutiva remove o pin', () => {
    const r = prunePinnedIdsWithGrace(['a', 'dead'], new Set(['a']), none, new Set(['dead']))
    expect(r.pinnedIds).toEqual(['a'])
    expect(r.missing).toEqual(new Set())
  })

  it('presença zera a carência: ausente → presente → ausente não remove', () => {
    const pins = ['x']
    const back = prunePinnedIdsWithGrace(pins, new Set(['x']), none, new Set(['x']))
    expect(back.pinnedIds).toBe(pins)
    expect(back.missing).toEqual(new Set())
    const goneAgain = prunePinnedIdsWithGrace(back.pinnedIds, new Set(), none, back.missing)
    expect(goneAgain.pinnedIds).toBe(pins)
    expect(goneAgain.missing).toEqual(new Set(['x']))
  })

  it('excludeIds (janela de undo) conta como presença: não remove nem acumula carência', () => {
    const pins = ['a', 'ending']
    const r = prunePinnedIdsWithGrace(
      pins,
      new Set(['a']),
      new Set(['ending']),
      new Set(['ending']),
    )
    expect(r.pinnedIds).toBe(pins)
    expect(r.missing).toEqual(new Set())
  })

  it('retorna o MESMO array quando nada é removido (skip de persistência)', () => {
    const pins = ['a', 'b']
    const r = prunePinnedIdsWithGrace(pins, new Set(['a', 'b']), none, none)
    expect(r.pinnedIds).toBe(pins)
  })

  it('todos ausentes por 2 rodadas → vazio', () => {
    const r = prunePinnedIdsWithGrace(['x', 'y'], new Set(), none, new Set(['x', 'y']))
    expect(r.pinnedIds).toEqual([])
  })
})

describe('mergePinnedIds', () => {
  it('persistidos primeiro (ordem original), toggles pré-load ao final', () => {
    expect(mergePinnedIds(['a', 'b'], ['c'])).toEqual(['a', 'b', 'c'])
  })

  it('sem novidade → mesma referência do persistido (skip de persistência)', () => {
    const persisted = ['a', 'b']
    expect(mergePinnedIds(persisted, [])).toBe(persisted)
    expect(mergePinnedIds(persisted, ['a'])).toBe(persisted)
  })

  it('deduplica: toggle pré-load de id já persistido não repete', () => {
    expect(mergePinnedIds(['a'], ['a', 'b'])).toEqual(['a', 'b'])
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
