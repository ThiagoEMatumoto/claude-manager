import type { ChatMessage, ChatQuestion } from '../../../shared/types/chat'

// Subconjunto relevante de uma linha do transcript JSONL do Claude Code. Mantemos
// um shape LOCAL (sem importar os internos do metrics-service/session-activity)
// porque este é o contrato cru em disco — o mesmo que aqueles módulos leem cada um
// pro seu fim. Acoplar os três parsers não compraria nada e amarraria evoluções.
interface RawContentItem {
  type?: string
  text?: string
  // bloco de raciocínio (extended thinking); redacted_thinking não traz texto.
  thinking?: string
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
  // Linhas type:'system': metadados de nível de linha (sem `message`). subtype
  // classifica; content/error trazem o texto; level a severidade.
  subtype?: string
  content?: string
  level?: string
  error?: unknown
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

// Dados de um subagente associados à sua invocação (Task/Agent), por toolUseId.
// Montados no service a partir dos arquivos agent-*.meta.json/.jsonl e injetados
// no parser pra virar o kind 'subagent' no lugar do tool_use genérico.
export interface SubagentInfo {
  name: string
  description: string
  turnCount: number
  turns: string[]
}

// Resumo de um turno de subagente: junta os blocos de texto do assistant; se não
// houver texto (turno só de tool_use), lista os nomes das ferramentas. Trunca pra
// não inchar o payload do IPC (a UI mostra o snippet, expansível sob demanda).
function summarizeAssistantTurn(content: string | RawContentItem[] | undefined): string {
  const truncate = (s: string, max = 280): string => {
    const t = s.replace(/\s+/g, ' ').trim()
    return t.length > max ? t.slice(0, max) + '…' : t
  }
  if (typeof content === 'string') return truncate(content)
  if (!Array.isArray(content)) return ''
  const text = content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
    .trim()
  if (text) return truncate(text)
  const tools = content
    .filter((c) => c?.type === 'tool_use' && typeof c.name === 'string')
    .map((c) => c.name as string)
  return tools.length ? `⚙ ${tools.join(', ')}` : ''
}

// PURO: conteúdo de um agent-<hash>.jsonl → contagem de turnos + resumos. Cada
// linha type==='assistant' é um turno do subagente (todas isSidechain). Tolerante a
// linha malformada (pula a linha, nunca o arquivo).
export function parseSubagentTurns(jsonl: string): { turnCount: number; turns: string[] } {
  let turnCount = 0
  const turns: string[] = []
  for (const raw of jsonl.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let obj: RawLine
    try {
      obj = JSON.parse(line) as RawLine
    } catch {
      continue
    }
    if (obj.type !== 'assistant') continue
    turnCount += 1
    const text = summarizeAssistantTurn(obj.message?.content)
    if (text) turns.push(text)
  }
  return { turnCount, turns }
}

// Subtypes de linha type:'system' que VALEM mostrar no chat (curadoria). O resto
// (stop_hook_summary, turn_duration, scheduled_task_fire, away_summary, …) é
// telemetria/ruído de alto volume e fica de fora — nada de despejar cru.
const SYSTEM_LABELS: Record<string, string> = {
  compact_boundary: 'Conversa compactada',
  api_error: 'Erro de API',
  informational: 'Sistema',
  local_command: 'Comando local',
}

function asLevel(v: unknown): 'info' | 'warning' | 'error' {
  return v === 'warning' || v === 'error' ? v : 'info'
}

// PURO: linha system → chip curado, ou null se for um subtype não-whitelistado.
// label = texto curto do chip (sempre visível); detail = conteúdo expandido.
function parseSystemLine(
  obj: RawLine,
): { label: string; detail: string; level: 'info' | 'warning' | 'error' } | null {
  const sub = obj.subtype
  if (!sub || !(sub in SYSTEM_LABELS)) return null
  let label = SYSTEM_LABELS[sub]
  const content = typeof obj.content === 'string' ? obj.content : ''
  if (sub === 'api_error') {
    const detail = typeof obj.error === 'string' ? obj.error : content || JSON.stringify(obj.error ?? '')
    return { label, detail, level: 'error' }
  }
  if (sub === 'local_command') {
    // content vem como <command-name>/x</command-name>… — extrai o nome pro chip.
    const name = /<command-name>([^<]*)<\/command-name>/.exec(content)?.[1]?.trim()
    if (name) label = `Comando ${name}`
  }
  return { label, detail: content || label, level: asLevel(obj.level) }
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
// Subagentes (Task/Agent): quando `subagents` traz dados para o id do tool_use, ele
// vira o kind 'subagent' (nome + descrição + turnos) no lugar do tool_use genérico.
// Sem dados (map ausente/miss), permanece tool_use — degrada sem quebrar.
//
// LIMITAÇÃO: prompts de permissão de tool (y/n de Edit/Bash) são TTY-only e NÃO
// vão pro JSONL — o chat não os mostra a partir do transcript (fallback: terminal).
export function parseChatMessages(
  jsonl: string,
  subagents?: Map<string, SubagentInfo>,
): ChatMessage[] {
  const out: ChatMessage[] = []
  // Ids de tool_use interativos já vistos, pra classificar o tool_result seguinte.
  const askIds = new Set<string>()
  const planIds = new Set<string>()
  // Ids de tool_use que viraram subagente, pra dobrar o status (is_error) do
  // tool_result no card em vez de mostrar um tool_result genérico duplicado.
  const subIds = new Set<string>()
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
    if (obj.type === 'system') {
      const sys = parseSystemLine(obj)
      if (sys) out.push({ kind: 'system', ...sys })
      continue
    }
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
            } else if (subIds.has(forId)) {
              out.push({ kind: 'subagent_result', forId, isError: item.is_error === true })
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
        } else if (item?.type === 'thinking') {
          // Blocos de thinking costumam vir vazios (só assinatura) quando o modelo
          // não expõe o raciocínio — só emitimos quando há texto de fato.
          const t = typeof item.thinking === 'string' ? item.thinking.trim() : ''
          if (t) out.push({ kind: 'thinking', text: t })
        } else if (item?.type === 'redacted_thinking') {
          out.push({ kind: 'thinking', text: '(raciocínio oculto)' })
        } else if (item?.type === 'tool_use' && typeof item.name === 'string') {
          const id = typeof item.id === 'string' ? item.id : ''
          const sub = id ? subagents?.get(id) : undefined
          if (sub) {
            if (id) subIds.add(id)
            out.push({
              kind: 'subagent',
              id,
              name: sub.name,
              description: sub.description,
              turnCount: sub.turnCount,
              turns: sub.turns,
            })
          } else if (item.name === 'AskUserQuestion') {
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
