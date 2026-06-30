import { useEffect, useState } from 'react'
import { chatApi } from '@/lib/ipc'
import type { ChatMessage } from '../../../../shared/types/ipc'

// Assina o transcript de uma sessão enquanto montado: read inicial + watch do
// JSONL. O broadcast manda a LISTA completa reparseada, então só substituímos o
// estado. unwatch no unmount (toggle pro terminal desmonta o ChatView).
export function useChatTranscript(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  // O read inicial sinaliza inexistência via path null; o broadcast via flag. Isso
  // distingue "aguardando transcript" (arquivo não nasceu) de "vazio real".
  const [transcriptExists, setTranscriptExists] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Race fix: se um update do watch chegar antes (ou durante) o read inicial, ele
    // é a verdade mais nova — não deixamos o resultado do getTranscript (mais velho)
    // sobrescrevê-lo. Também garante que a 1ª atualização (ex: pergunta recém-escrita)
    // não se perca na janela entre disparar o read e assinar o watch.
    let gotUpdate = false
    setLoading(true)

    // Assina ANTES do read pra não perder updates emitidos nessa janela.
    chatApi.watch(sessionId)
    const off = chatApi.onTranscriptUpdate((u) => {
      if (u.sessionId !== sessionId) return
      gotUpdate = true
      setMessages(u.messages)
      setTranscriptExists(u.transcriptExists)
      setLoading(false)
    })

    void chatApi
      .getTranscript(sessionId)
      .then((t) => {
        if (cancelled || gotUpdate) return
        setMessages(t.messages)
        setTranscriptExists(t.path !== null)
        setLoading(false)
      })
      .catch(() => {
        // Sessão sem transcript no disco ainda (recém-spawnada) ou leitura falhou:
        // segue como vazio; o watch traz as mensagens quando o arquivo aparecer.
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
      off()
      chatApi.unwatch(sessionId)
    }
  }, [sessionId])

  return { messages, loading, transcriptExists }
}
