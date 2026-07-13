import { useEffect, useMemo, useState } from 'react'
import { sessionsApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'
import { childSessionIds, useHandoffsStore } from '@/store/handoffsStore'
import type { LiveSessionInfo } from '../../../shared/types/ipc'

// Sessões vivas "visíveis" pro usuário: filhas de handoffs ativos ficam no
// rollup do painel Handoffs, fora de seletores (SessionSwitcher e CommandPalette).
export function useVisibleLiveSessions(): LiveSessionInfo[] {
  const allLiveSessions = useAppStore((s) => s.liveSessions)
  const handoffs = useHandoffsStore((s) => s.handoffs)
  return useMemo(() => {
    const childIds = childSessionIds(handoffs)
    return allLiveSessions.filter((s) => !childIds.has(s.id))
  }, [allLiveSessions, handoffs])
}

// Encerradas retomáveis, carregadas sob demanda quando `enabled` liga.
// null = ainda carregando (ou fetch nem disparou).
export function useEndedSessions(enabled: boolean): LiveSessionInfo[] | null {
  const [ended, setEnded] = useState<LiveSessionInfo[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    setEnded(null)
    let cancelled = false
    void sessionsApi.listEndedGlobal().then((list) => {
      if (!cancelled) setEnded(list)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return ended
}
