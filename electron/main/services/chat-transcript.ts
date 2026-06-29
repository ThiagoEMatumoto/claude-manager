import type { ChatMessage } from '../../../shared/types/chat'

// Subconjunto relevante de uma linha do transcript JSONL do Claude Code. Mantemos
// um shape LOCAL (sem importar os internos do metrics-service/session-activity)
// porque este é o contrato cru em disco — o mesmo que aqueles módulos leem cada um
// pro seu fim. Acoplar os três parsers não compraria nada e amarraria evoluções.
interface RawContentItem {
  type?: string
  text?: string
  // tool_use (assistant)
  id?: string
  name?: string
  input?: unknown
  // tool_result (user)
  tool_use_id?: string
  content?: string | RawContentItem[]
  is_error?: boolean
}

interface RawLine {
  type?: string
  // Turnos de subagente (Task) vivem inline com isSidechain:true.
  isSidechain?: boolean
  message?: {
    role?: string
    content?: string | RawContentItem[]
  }
}

// Normaliza o content de um tool_result para string: a CLI grava ou uma string
// crua ou um array de blocos { type:'text', text }. Junta os blocos de texto;
// ignora blocos não-textuais (ex.: imagens), que a F5b trataria à parte.
function toText(content: string | RawContentItem[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
}

// PURO: JSONL inteiro → lista ordenada de mensagens de chat. Tolerante a linha
// malformada (try/catch por linha, pula) — a última linha pode estar partida por
// escrita parcial durante o streaming. Linhas que não são user/assistant
// (ai-title, custom-title, queue-operation, attachment, summary, etc.) e turnos de
// subagente (isSidechain) são ignorados: o chat renderiza a conversa principal.
export function parseChatMessages(jsonl: string): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const raw of jsonl.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let obj: RawLine
    try {
      obj = JSON.parse(line) as RawLine
    } catch {
      continue // malformada / escrita parcial — pula a linha, nunca o arquivo.
    }
    if (obj.isSidechain === true) continue
    if (obj.type !== 'user' && obj.type !== 'assistant') continue

    const content = obj.message?.content

    if (obj.type === 'user') {
      if (typeof content === 'string') {
        if (content.trim()) out.push({ kind: 'user', text: content })
        continue
      }
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type === 'tool_result') {
            out.push({
              kind: 'tool_result',
              forId: typeof item.tool_use_id === 'string' ? item.tool_use_id : '',
              content: toText(item.content),
              isError: item.is_error === true,
            })
          } else if (item?.type === 'text' && typeof item.text === 'string') {
            if (item.text.trim()) out.push({ kind: 'user', text: item.text })
          }
        }
      }
      continue
    }

    // assistant
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === 'text' && typeof item.text === 'string') {
          if (item.text.trim()) out.push({ kind: 'assistant', text: item.text })
        } else if (item?.type === 'tool_use' && typeof item.name === 'string') {
          out.push({
            kind: 'tool_use',
            id: typeof item.id === 'string' ? item.id : '',
            name: item.name,
            input: item.input,
          })
        }
      }
    } else if (typeof content === 'string' && content.trim()) {
      out.push({ kind: 'assistant', text: content })
    }
  }
  return out
}
