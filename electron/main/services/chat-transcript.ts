import type { ChatMessage, ChatQuestion } from '../../../shared/types/chat'

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
  // Campo IRMÃO de `message` (nível da linha, não do content). A CLI grava aqui o
  // resultado estruturado do tool_use que a linha responde: `answers` (mapa
  // pergunta→opção) pro AskUserQuestion, `plan`/`filePath` pro ExitPlanMode.
  toolUseResult?: unknown
}

// AskUserQuestion: input.questions[] = { question, header, multiSelect, options:[{label,description}] }.
function parseQuestions(input: unknown): ChatQuestion[] {
  if (!input || typeof input !== 'object') return []
  const qs = (input as { questions?: unknown }).questions
  if (!Array.isArray(qs)) return []
  return qs.map((q) => {
    const o = (q ?? {}) as Record<string, unknown>
    const options = Array.isArray(o.options)
      ? o.options.map((opt) => {
          const oo = (opt ?? {}) as Record<string, unknown>
          return {
            label: typeof oo.label === 'string' ? oo.label : '',
            description: typeof oo.description === 'string' ? oo.description : '',
          }
        })
      : []
    return {
      question: typeof o.question === 'string' ? o.question : '',
      header: typeof o.header === 'string' ? o.header : '',
      multiSelect: o.multiSelect === true,
      options,
    }
  })
}

// ExitPlanMode: input.plan (markdown) + input.allowedPrompts (pode ser null).
function parsePlan(input: unknown): { plan: string; allowedPrompts: string[] | null } {
  const o = (input ?? {}) as Record<string, unknown>
  const ap = o.allowedPrompts
  return {
    plan: typeof o.plan === 'string' ? o.plan : '',
    allowedPrompts: Array.isArray(ap) ? ap.filter((p): p is string => typeof p === 'string') : null,
  }
}

// Mapa pergunta→opção(ões) escolhida(s) do toolUseResult de um AskUserQuestion.
function parseAnswers(tur: unknown): Record<string, string> {
  if (!tur || typeof tur !== 'object') return {}
  const ans = (tur as { answers?: unknown }).answers
  if (!ans || typeof ans !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(ans as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
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
//
// Momentos interativos do claude ganham kinds próprios (não caem como tool_use/
// tool_result genéricos): AskUserQuestion → ask_user_question (+ ..._answered) e
// ExitPlanMode → exit_plan_mode (+ plan_decision). O tool_use vem antes do seu
// tool_result no transcript, então linkamos por id via os Sets abaixo.
//
// LIMITAÇÃO: prompts de permissão de tool (y/n de Edit/Bash) são TTY-only e NÃO
// vão pro JSONL — o chat não os mostra a partir do transcript (fallback: terminal).
export function parseChatMessages(jsonl: string): ChatMessage[] {
  const out: ChatMessage[] = []
  // Ids de tool_use interativos já vistos, pra classificar o tool_result seguinte.
  const askIds = new Set<string>()
  const planIds = new Set<string>()
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
            const forId = typeof item.tool_use_id === 'string' ? item.tool_use_id : ''
            if (askIds.has(forId)) {
              out.push({
                kind: 'ask_user_question_answered',
                forId,
                answers: parseAnswers(obj.toolUseResult),
              })
            } else if (planIds.has(forId)) {
              // Aprovação tem texto canônico "User has approved your plan."; a
              // ausência dele (rejeição/feedback) marca não-aprovado.
              out.push({
                kind: 'plan_decision',
                forId,
                approved: /User has approved/i.test(toText(item.content)),
              })
            } else {
              out.push({
                kind: 'tool_result',
                forId,
                content: toText(item.content),
                isError: item.is_error === true,
              })
            }
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
          const id = typeof item.id === 'string' ? item.id : ''
          if (item.name === 'AskUserQuestion') {
            if (id) askIds.add(id)
            out.push({ kind: 'ask_user_question', id, questions: parseQuestions(item.input) })
          } else if (item.name === 'ExitPlanMode') {
            if (id) planIds.add(id)
            out.push({ kind: 'exit_plan_mode', id, ...parsePlan(item.input) })
          } else {
            out.push({ kind: 'tool_use', id, name: item.name, input: item.input })
          }
        }
      }
    } else if (typeof content === 'string' && content.trim()) {
      out.push({ kind: 'assistant', text: content })
    }
  }
  return out
}
