import { describe, expect, it } from 'vitest'
import { parseChatMessages } from './chat-transcript'

// Fixture representativo: prompt do usuário, resposta assistant com texto +
// tool_use, tool_result do usuário (string e array), uma linha não-mensagem, uma
// linha malformada e um turno de subagente (isSidechain). Cada linha é um JSON.
const FIXTURE = [
  JSON.stringify({ type: 'ai-title', aiTitle: 'Some title' }), // não-mensagem → ignorada
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'Read /a and tell me' } }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Sure, let me read it.' },
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a' } },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file body', is_error: false }],
    },
  }),
  '{ this is not valid json', // malformada → pulada
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'ls' } },
        { type: 'text', text: '' }, // texto vazio → não vira bubble
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_2',
          content: [{ type: 'text', text: 'permission denied' }],
          is_error: true,
        },
      ],
    },
  }),
  // turno de subagente: deve ser ignorado mesmo sendo user/assistant válido.
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    message: { role: 'assistant', content: [{ type: 'text', text: 'subagent internal' }] },
  }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }),
].join('\n')

describe('parseChatMessages', () => {
  const messages = parseChatMessages(FIXTURE)

  it('produces messages in transcript order', () => {
    expect(messages.map((m) => m.kind)).toEqual([
      'user', // "Read /a and tell me"
      'assistant', // "Sure, let me read it."
      'tool_use', // Read tu_1
      'tool_result', // tu_1
      'tool_use', // Bash tu_2 (texto vazio da mesma linha não entra)
      'tool_result', // tu_2 (array content)
      'assistant', // "Done."
    ])
  })

  it('captures user text and assistant text verbatim', () => {
    expect(messages[0]).toEqual({ kind: 'user', text: 'Read /a and tell me' })
    expect(messages[1]).toEqual({ kind: 'assistant', text: 'Sure, let me read it.' })
    expect(messages[6]).toEqual({ kind: 'assistant', text: 'Done.' })
  })

  it('captures tool_use blocks with id/name/input', () => {
    expect(messages[2]).toEqual({
      kind: 'tool_use',
      id: 'tu_1',
      name: 'Read',
      input: { file_path: '/a' },
    })
    expect(messages[4]).toEqual({
      kind: 'tool_use',
      id: 'tu_2',
      name: 'Bash',
      input: { command: 'ls' },
    })
  })

  it('captures tool_result (string and array content) with forId/isError', () => {
    expect(messages[3]).toEqual({
      kind: 'tool_result',
      forId: 'tu_1',
      content: 'file body',
      isError: false,
    })
    expect(messages[5]).toEqual({
      kind: 'tool_result',
      forId: 'tu_2',
      content: 'permission denied', // array de blocos de texto → string
      isError: true,
    })
  })

  it('ignores malformed lines, non-message lines and subagent (sidechain) turns', () => {
    // 7 mensagens apesar de 1 linha malformada, 1 ai-title, 1 sidechain e 1 texto vazio.
    expect(messages).toHaveLength(7)
    expect(messages.some((m) => m.kind === 'assistant' && m.text === 'subagent internal')).toBe(
      false,
    )
  })

  it('returns an empty list for empty or whitespace input', () => {
    expect(parseChatMessages('')).toEqual([])
    expect(parseChatMessages('   \n  \n')).toEqual([])
  })
})
