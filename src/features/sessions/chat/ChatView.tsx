import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Clock, Loader, TerminalSquare } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { ChatMessage, SessionActivity } from '../../../../shared/types/ipc'
import { MessageBubble } from './MessageBubble'
import { PlanCard } from './PlanCard'
import { QuestionCard } from './QuestionCard'
import { SubagentCard } from './SubagentCard'
import { SystemCard } from './SystemCard'
import { ThinkingCard } from './ThinkingCard'
import { ToolResultCard, ToolUseCard } from './ToolCard'
import { useChatTranscript } from './useChatTranscript'
import { buildPlanKeys, buildQuestionKeys } from './respond-keys'
import {
  countUserMessages,
  isAtBottom,
  nextResolveAt,
  pendingEchoes,
  pendingInteractive,
  resolveChatViewState,
  resolveInteractive,
  showTerminalWaitBanner,
  type Echo,
} from './chat-logic'

export interface ChatViewHandle {
  // Eco otimista: chamado pelo Terminal ao enviar pelo composer em modo chat.
  pushEcho: (text: string) => void
}

interface Props {
  sessionId: string
  // Status da sessão (do broadcast session:activity, via Terminal) pra mostrar um
  // indicador discreto de "trabalhando" enquanto o claude computa a resposta.
  status?: SessionActivity['status']
  // Alterna pro modo terminal. Usado pelo banner de espera genérica (ex.: prompt
  // de permissão y/n, TTY-only) pra levar o usuário ao único lugar que o renderiza.
  onToggleMode?: () => void
  // Reproduz sequências de teclas no PTY vivo (mesmo write() do onForwardKey do
  // composer). Vem do Terminal; ausente = cards ficam read-only.
  onRespond?: (seqs: string[]) => void
}

// Render híbrido do transcript JSONL. O PTY segue vivo por baixo (xterm oculto no
// Terminal); esta view só LÊ o transcript e adiciona ecos otimistas das mensagens
// recém-enviadas até o disco alcançar.
export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView({ sessionId, status, onToggleMode, onRespond }, ref) {
  const { messages, loading, transcriptExists } = useChatTranscript(sessionId)
  const [echoes, setEchoes] = useState<Echo[]>([])
  // Eco otimista de um clique num card interativo: teclas já enviadas ao PTY, mas a
  // resposta/decisão real ainda não chegou no JSONL. Bloqueia novos cliques.
  const [sent, setSent] = useState<{ id: string; label?: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Só auto-scrollamos se o usuário já estava colado no fim (não roubamos a
  // rolagem de quem subiu pra reler).
  const stickRef = useRef(true)

  const diskUserCount = useMemo(() => countUserMessages(messages), [messages])

  useImperativeHandle(
    ref,
    () => ({
      pushEcho: (text: string) => {
        stickRef.current = true
        setEchoes((prev) => [...prev, { text, resolveAt: nextResolveAt(diskUserCount, prev.length) }])
      },
    }),
    [diskUserCount],
  )

  // Poda ecos resolvidos quando a contagem de usuário no disco avança.
  useEffect(() => {
    setEchoes((prev) => {
      const next = pendingEchoes(prev, diskUserCount)
      return next.length === prev.length ? prev : next
    })
  }, [diskUserCount])

  function onScroll() {
    const el = scrollRef.current
    if (el) stickRef.current = isAtBottom(el)
  }

  const rendered = useMemo<ChatMessage[]>(
    () => [...messages, ...echoes.map((e) => ({ kind: 'user', text: e.text }) as ChatMessage)],
    [messages, echoes],
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [rendered])

  // Re-pina no fim quando a ALTURA do conteúdo cresce de forma assíncrona (syntax
  // highlight, imagens, web-font swap, expand de card) — o effect de [rendered] acima
  // só roda no commit do React e perde esse crescimento. Observa o div de conteúdo via
  // callback ref (que só existe no estado 'ready') e reusa o MESMO stickRef, então o
  // scroll-up desengata daqui também.
  const observerRef = useRef<ResizeObserver | null>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current
      if (el && stickRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(node)
    observerRef.current = ro
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])

  // Liga cada pergunta/plano (por id) à resposta/decisão posterior, pra fundir
  // ambos no mesmo card e não renderizar a mensagem de resposta solta. Sobre as
  // mensagens de disco: ecos otimistas são só texto do usuário.
  const interactive = useMemo(() => resolveInteractive(messages), [messages])
  const pendingPrompt = useMemo(() => pendingInteractive(messages), [messages])
  // Espera que o chat não consegue representar (provável prompt de permissão
  // y/n / menu TTY): status 'waiting' sem um card de pergunta/plano conhecido.
  const waitInTerminal = showTerminalWaitBanner({ status, pending: pendingPrompt })

  // Reconciliação do clique otimista: a resposta/decisão REAL do JSONL prevalece.
  // Limpa quando ela chega (via forId) ou quando o momento pendente mudou (ex.:
  // prompt dispensado pelo terminal) — senão o sent velho bloquearia cliques novos.
  useEffect(() => {
    if (!sent) return
    const resolved = interactive.answers.has(sent.id) || interactive.plans.has(sent.id)
    if (resolved || pendingPrompt?.id !== sent.id) setSent(null)
  }, [sent, interactive, pendingPrompt])

  // Guard duplo: os cards só recebem onRespond/onDecide quando são o momento
  // pendente com a sessão 'waiting', E o handler re-checa tudo na hora do clique —
  // nunca digitar no PTY fora de hora.
  const canRespond = (id: string): boolean =>
    onRespond != null && status === 'waiting' && pendingPrompt?.id === id && sent == null

  function respondQuestion(id: string, optionIndex: number, label: string) {
    if (!canRespond(id)) return
    setSent({ id, label })
    onRespond?.(buildQuestionKeys(optionIndex))
  }

  function respondPlan(id: string, d: 'approve' | 'reject') {
    if (!canRespond(id)) return
    setSent({ id })
    onRespond?.(buildPlanKeys(d))
  }

  const viewState = resolveChatViewState({
    loading,
    transcriptExists,
    messageCount: rendered.length,
  })

  if (viewState !== 'ready') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-bg)] p-6 text-center text-sm text-[var(--color-text-dim)]">
        {(viewState === 'loading' || viewState === 'waiting') && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-dim)]" />
        )}
        {viewState === 'loading' && 'Carregando conversa…'}
        {viewState === 'waiting' &&
          'Aguardando transcript… a conversa aparece assim que o claude responder.'}
        {viewState === 'empty' &&
          'Sem mensagens ainda. Envie um prompt pelo compositor abaixo — a conversa aparece aqui assim que o claude responder.'}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="absolute inset-0 z-10 overflow-y-auto bg-[var(--color-bg)] px-3 py-4"
    >
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3">
        {rendered.map((m, i) => {
          // Ecos otimistas vêm DEPOIS das mensagens de disco; marcamos como pendentes.
          const echoPending = i >= messages.length
          switch (m.kind) {
            case 'user':
              return <MessageBubble key={i} role="user" text={m.text} pending={echoPending} />
            case 'assistant':
              return <MessageBubble key={i} role="assistant" text={m.text} />
            case 'thinking':
              return <ThinkingCard key={i} text={m.text} />
            case 'system':
              return <SystemCard key={i} label={m.label} detail={m.detail} level={m.level} />
            case 'tool_use':
              return <ToolUseCard key={i} name={m.name} input={m.input} />
            case 'subagent':
              return (
                <SubagentCard
                  key={i}
                  name={m.name}
                  description={m.description}
                  turnCount={m.turnCount}
                  turns={m.turns}
                  status={
                    interactive.subagents.has(m.id)
                      ? interactive.subagents.get(m.id)
                        ? 'error'
                        : 'ok'
                      : undefined
                  }
                />
              )
            case 'tool_result':
              return <ToolResultCard key={i} content={m.content} isError={m.isError} />
            case 'ask_user_question':
              return (
                <QuestionCard
                  key={i}
                  questions={m.questions}
                  answers={interactive.answers.get(m.id)}
                  onRespond={
                    canRespond(m.id)
                      ? (oi, label) => respondQuestion(m.id, oi, label)
                      : undefined
                  }
                  sentLabel={sent?.id === m.id ? sent.label : undefined}
                />
              )
            case 'exit_plan_mode':
              return (
                <PlanCard
                  key={i}
                  plan={m.plan}
                  decision={interactive.plans.get(m.id)}
                  onDecide={canRespond(m.id) ? (d) => respondPlan(m.id, d) : undefined}
                  sent={sent?.id === m.id}
                />
              )
            // Resposta/decisão/status são fundidos no card acima (por forId) — não
            // renderizam sozinhos.
            case 'ask_user_question_answered':
            case 'plan_decision':
            case 'subagent_result':
              return null
          }
        })}
        {pendingPrompt && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            <Icon as={Clock} size={14} className="shrink-0 text-[var(--color-accent)]" />
            {sent
              ? 'Resposta enviada — aguardando confirmação…'
              : pendingPrompt.kind === 'plan'
                ? 'Claude está aguardando sua aprovação do plano — responda no compositor ou no terminal.'
                : 'Claude está aguardando sua resposta — responda no compositor ou no terminal.'}
          </div>
        )}
        {/* Espera genérica (TTY-only): o chat não tem card pra mostrar. Direciona ao
            terminal, único lugar que renderiza o prompt (ex.: permissão y/n). */}
        {waitInTerminal && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-md border border-[var(--color-warning)]/60 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-warning)]" />
            <Icon as={Clock} size={14} className="shrink-0 text-[var(--color-warning)]" />
            <span className="flex-1">
              Claude está aguardando sua resposta no terminal (ex.: permissão). Abra o Terminal pra
              responder.
            </span>
            {onToggleMode && (
              <button
                type="button"
                onClick={onToggleMode}
                className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs font-medium hover:border-[var(--color-warning)]"
              >
                <Icon as={TerminalSquare} size={13} />
                Ir pro Terminal
              </button>
            )}
          </div>
        )}
        {/* Indicador discreto de atividade. Suprimido quando há um prompt pendente
            (status 'waiting'), pra não competir com o banner acima. */}
        {status === 'working' && !pendingPrompt && (
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--color-text-dim)]">
            <Icon as={Loader} size={13} className="animate-spin text-[var(--color-accent)]" />
            Claude está trabalhando…
          </div>
        )}
      </div>
    </div>
  )
})
