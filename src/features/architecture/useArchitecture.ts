import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { useArchitectureStore } from '@/store/architectureStore'

// Carrega repos + deps da vista corrente e mantém a assinatura de onUpdated viva
// enquanto a área de arquitetura estiver montada. A vista (viewMode) segue o
// projeto ativo, EXCETO quando o usuário escolheu 'global' explicitamente — aí o
// global manda e a troca de projeto ativo não recarrega o canvas. StrictMode-safe.
export function useArchitecture() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const load = useArchitectureStore((s) => s.load)
  const startUpdatedWatch = useArchitectureStore((s) => s.startUpdatedWatch)
  const stopUpdatedWatch = useArchitectureStore((s) => s.stopUpdatedWatch)

  useEffect(() => {
    startUpdatedWatch()
    return () => stopUpdatedWatch()
  }, [startUpdatedWatch, stopUpdatedWatch])

  useEffect(() => {
    const view = useArchitectureStore.getState().viewMode
    // Global é uma escolha pegajosa: não a sobrescreve ao trocar de projeto.
    if (view === 'global') return
    if (activeProjectId) void load(activeProjectId)
  }, [activeProjectId, load])
}
