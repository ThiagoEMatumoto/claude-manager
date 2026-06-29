import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../shared/types/ipc'
import {
  countUserMessages,
  isAtBottom,
  nextResolveAt,
  pendingEchoes,
  resolveChatViewState,
  type Echo,
} from './chat-logic'

const user = (text: string): ChatMessage => ({ kind: 'user', text })
const assistant = (text: string): ChatMessage => ({ kind: 'assistant', text })

describe('countUserMessages', () => {
  it('counts only user messages', () => {
    const msgs: ChatMessage[] = [
      user('a'),
      assistant('b'),
      { kind: 'tool_use', id: 't1', name: 'Read', input: {} },
      { kind: 'tool_result', forId: 't1', content: 'x', isError: false },
      user('c'),
    ]
    expect(countUserMessages(msgs)).toBe(2)
  })

  it('is zero for an empty transcript', () => {
    expect(countUserMessages([])).toBe(0)
  })
})

describe('optimistic echo reconciliation', () => {
  it('keeps a single echo until its user message reaches disk', () => {
    // Disco começa sem nenhuma mensagem do usuário.
    let echoes: Echo[] = []
    echoes = [...echoes, { text: 'hello', resolveAt: nextResolveAt(0, echoes.length) }]
    // Ainda 0 no disco → o eco permanece.
    expect(pendingEchoes(echoes, 0)).toHaveLength(1)
    // Disco passa a ter 1 mensagem de usuário → o eco resolve e some.
    expect(pendingEchoes(echoes, 1)).toHaveLength(0)
  })

  it('does not let one disk write resolve a different pending echo', () => {
    // Dois envios rápidos antes de qualquer gravação em disco.
    let echoes: Echo[] = []
    echoes = [...echoes, { text: 'first', resolveAt: nextResolveAt(0, echoes.length) }]
    echoes = [...echoes, { text: 'second', resolveAt: nextResolveAt(0, echoes.length) }]
    // Disco grava só o primeiro (count = 1): 'first' resolve, 'second' fica.
    const after1 = pendingEchoes(echoes, 1)
    expect(after1.map((e) => e.text)).toEqual(['second'])
    // Disco grava o segundo (count = 2): nada pendente.
    expect(pendingEchoes(echoes, 2)).toHaveLength(0)
  })

  it('does not resolve an echo against pre-existing history of the same text', () => {
    // Já existe 1 mensagem 'hello' no histórico ao enviar um novo 'hello'.
    const echo: Echo = { text: 'hello', resolveAt: nextResolveAt(1, 0) }
    // Disco continua com 1 (o novo ainda não gravou) → o eco permanece visível.
    expect(pendingEchoes([echo], 1)).toHaveLength(1)
    // Disco vai a 2 (o novo 'hello' gravou) → resolve.
    expect(pendingEchoes([echo], 2)).toHaveLength(0)
  })
})

describe('resolveChatViewState', () => {
  it('is loading before the first read returns (no file known yet)', () => {
    expect(resolveChatViewState({ loading: true, transcriptExists: false, messageCount: 0 })).toBe(
      'loading',
    )
  })

  it('waits when the read finished and no transcript exists on disk', () => {
    expect(resolveChatViewState({ loading: false, transcriptExists: false, messageCount: 0 })).toBe(
      'waiting',
    )
  })

  it('is empty when the transcript exists but has no renderable messages', () => {
    expect(resolveChatViewState({ loading: false, transcriptExists: true, messageCount: 0 })).toBe(
      'empty',
    )
  })

  it('is ready as soon as there is anything to render', () => {
    expect(resolveChatViewState({ loading: false, transcriptExists: true, messageCount: 3 })).toBe(
      'ready',
    )
  })

  it('renders content (echo) even while still loading or pre-flush', () => {
    // Eco otimista enviado antes do disco alcançar: messageCount > 0 vence loading/waiting.
    expect(resolveChatViewState({ loading: true, transcriptExists: false, messageCount: 1 })).toBe(
      'ready',
    )
    expect(resolveChatViewState({ loading: false, transcriptExists: false, messageCount: 1 })).toBe(
      'ready',
    )
  })
})

describe('isAtBottom', () => {
  it('is true at the exact bottom', () => {
    expect(isAtBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true)
  })

  it('is true within the threshold (subpixel / one growing line)', () => {
    expect(isAtBottom({ scrollTop: 790, scrollHeight: 1000, clientHeight: 200 })).toBe(true)
  })

  it('is false when scrolled up beyond the threshold', () => {
    expect(isAtBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 200 })).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(isAtBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 200 }, 100)).toBe(true)
    expect(isAtBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 200 }, 100)).toBe(false)
  })
})
