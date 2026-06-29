import { useEffect, useState } from 'react'
import { chatApi } from '@/lib/ipc'
import type { ChatMessage } from '../../../../shared/types/ipc'

// Assina o transcript de uma sessão enquanto montado: read inicial + watch do
// JSONL. O broadcast manda a LISTA completa reparseada, então só substituímos o
// estado. unwatch no unmount (toggle pro terminal desmonta o ChatView).
export function useChatTranscript(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void chatApi
      .getTranscript(sessionId)
      .then((t) => {
        if (cancelled) return
        setMessages(t.messages)
        setLoading(false)
      })
      .catch(() => {
        // Sessão sem transcript no disco ainda (recém-spawnada) ou leitura falhou:
        // segue como vazio; o watch traz as mensagens quando o arquivo aparecer.
        if (cancelled) return
        setLoading(false)
      })

    chatApi.watch(sessionId)
    const off = chatApi.onTranscriptUpdate((u) => {
      if (u.sessionId !== sessionId) return
      setMessages(u.messages)
    })

    return () => {
      cancelled = true
      off()
      chatApi.unwatch(sessionId)
    }
  }, [sessionId])

  return { messages, loading }
}
