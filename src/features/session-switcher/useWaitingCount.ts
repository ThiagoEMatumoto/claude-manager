import { useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { childSessionIds, useHandoffsStore } from '@/store/handoffsStore'

// Sessões aguardando input do usuário, excluindo filhas de handoff (mesma regra
// do switcher/strip: elas vivem no rollup do painel Handoffs). Alimenta os badges
// da IconRail e do botão do switcher.
export function useWaitingCount(): number {
  const liveSessions = useAppStore((s) => s.liveSessions)
  const handoffs = useHandoffsStore((s) => s.handoffs)
  return useMemo(() => {
    const childIds = childSessionIds(handoffs)
    return liveSessions.filter((s) => s.status === 'waiting' && !childIds.has(s.id)).length
  }, [liveSessions, handoffs])
}
