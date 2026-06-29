import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChatMessage } from '../../../../shared/types/ipc'
import { MessageBubble } from './MessageBubble'
import { ToolResultCard, ToolUseCard } from './ToolCard'
import { useChatTranscript } from './useChatTranscript'
import { countUserMessages, isAtBottom, nextResolveAt, pendingEchoes, type Echo } from './chat-logic'

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
  const { messages, loading } = useChatTranscript(sessionId)
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

  if (!loading && rendered.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[var(--color-text-dim)]">
        Sem mensagens ainda. Envie um prompt pelo compositor abaixo — a conversa aparece aqui
        assim que o claude responder.
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {loading && rendered.length === 0 && (
          <div className="text-center text-xs text-[var(--color-text-dim)]">Carregando conversa…</div>
        )}
        {rendered.map((m, i) => {
          // Ecos otimistas vêm DEPOIS das mensagens de disco; marcamos como pendentes.
          const pending = i >= messages.length
          switch (m.kind) {
            case 'user':
              return <MessageBubble key={i} role="user" text={m.text} pending={pending} />
            case 'assistant':
              return <MessageBubble key={i} role="assistant" text={m.text} />
            case 'tool_use':
              return <ToolUseCard key={i} name={m.name} input={m.input} />
            case 'tool_result':
              return <ToolResultCard key={i} content={m.content} isError={m.isError} />
          }
        })}
      </div>
    </div>
  )
})
