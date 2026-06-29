import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Clock } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { ChatMessage } from '../../../../shared/types/ipc'
import { MessageBubble } from './MessageBubble'
import { PlanCard } from './PlanCard'
import { QuestionCard } from './QuestionCard'
import { ToolResultCard, ToolUseCard } from './ToolCard'
import { useChatTranscript } from './useChatTranscript'
import {
  countUserMessages,
  isAtBottom,
  nextResolveAt,
  pendingEchoes,
  pendingInteractive,
  resolveChatViewState,
  resolveInteractive,
  type Echo,
} from './chat-logic'

export interface ChatViewHandle {
  // Eco otimista: chamado pelo Terminal ao enviar pelo composer em modo chat.
  pushEcho: (text: string) => void
}

interface Props {
  sessionId: string
}

// Render híbrido do transcript JSONL. O PTY segue vivo por baixo (xterm oculto no
// Terminal); esta view só LÊ o transcript e adiciona ecos otimistas das mensagens
// recém-enviadas até o disco alcançar.
export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView({ sessionId }, ref) {
  const { messages, loading, transcriptExists } = useChatTranscript(sessionId)
  const [echoes, setEchoes] = useState<Echo[]>([])
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

  // Liga cada pergunta/plano (por id) à resposta/decisão posterior, pra fundir
  // ambos no mesmo card e não renderizar a mensagem de resposta solta. Sobre as
  // mensagens de disco: ecos otimistas são só texto do usuário.
  const interactive = useMemo(() => resolveInteractive(messages), [messages])
  const pendingPrompt = useMemo(() => pendingInteractive(messages), [messages])

  const viewState = resolveChatViewState({
    loading,
    transcriptExists,
    messageCount: rendered.length,
  })

  if (viewState !== 'ready') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--color-text-dim)]">
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
    <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {rendered.map((m, i) => {
          // Ecos otimistas vêm DEPOIS das mensagens de disco; marcamos como pendentes.
          const echoPending = i >= messages.length
          switch (m.kind) {
            case 'user':
              return <MessageBubble key={i} role="user" text={m.text} pending={echoPending} />
            case 'assistant':
              return <MessageBubble key={i} role="assistant" text={m.text} />
            case 'tool_use':
              return <ToolUseCard key={i} name={m.name} input={m.input} />
            case 'tool_result':
              return <ToolResultCard key={i} content={m.content} isError={m.isError} />
            case 'ask_user_question':
              return <QuestionCard key={i} questions={m.questions} answers={interactive.answers.get(m.id)} />
            case 'exit_plan_mode':
              return <PlanCard key={i} plan={m.plan} decision={interactive.plans.get(m.id)} />
            // Resposta/decisão são fundidas no card acima (por forId) — não renderizam sozinhas.
            case 'ask_user_question_answered':
            case 'plan_decision':
              return null
          }
        })}
        {pendingPrompt && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            <Icon as={Clock} size={14} className="shrink-0 text-[var(--color-accent)]" />
            {pendingPrompt === 'plan'
              ? 'Claude está aguardando sua aprovação do plano — responda no compositor ou no terminal.'
              : 'Claude está aguardando sua resposta — responda no compositor ou no terminal.'}
          </div>
        )}
      </div>
    </div>
  )
})
