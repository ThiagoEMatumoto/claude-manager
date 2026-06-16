import { useEffect, useMemo, useRef } from 'react'
import { prefsApi } from '@/lib/ipc'
import { pendingHandoffs, useHandoffsStore } from '@/store/handoffsStore'

export const HANDOFFS_AUTO_APPROVE_KEY = 'handoffs.autoApprove'

// Monta a assinatura de handoffs (load + watch, StrictMode-safe via store) e
// aplica o auto-approve quando o pref está ligado: cada novo pendente é aprovado
// e spawnado automaticamente, sem abrir o dialog. Quando desligado (default), o
// dialog cuida do gate humano.
export function useHandoffs() {
  const load = useHandoffsStore((s) => s.load)
  const start = useHandoffsStore((s) => s.startUpdatedWatch)
  const stop = useHandoffsStore((s) => s.stopUpdatedWatch)
  const approve = useHandoffsStore((s) => s.approve)
  const handoffs = useHandoffsStore((s) => s.handoffs)
  const pending = useMemo(() => pendingHandoffs(handoffs), [handoffs])

  // Pref lido no mount; mantido em ref pra o effect de auto-approve não re-rodar
  // por mudança de identidade.
  const autoApprove = useRef(false)
  // Ids já disparados pelo auto-approve, pra não tentar duas vezes enquanto o
  // approve está em voo (o handoff só sai de 'pending' após o markRunning).
  const firing = useRef(new Set<string>())

  useEffect(() => {
    void load()
    start()
    void prefsApi.get<boolean>(HANDOFFS_AUTO_APPROVE_KEY).then((v) => {
      autoApprove.current = v ?? false
    })
    return () => stop()
  }, [load, start, stop])

  useEffect(() => {
    if (!autoApprove.current) return
    for (const h of pending) {
      if (firing.current.has(h.id)) continue
      firing.current.add(h.id)
      void approve(h.id, h.composedPrompt).catch(() => {
        // Falhou: libera pra uma nova tentativa (ex: usuário liga/desliga).
        firing.current.delete(h.id)
      })
    }
  }, [pending, approve])
}
