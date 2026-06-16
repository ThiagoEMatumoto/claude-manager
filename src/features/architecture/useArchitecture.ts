import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { useArchitectureStore } from '@/store/architectureStore'

// Carrega repos + deps do projeto ativo e mantém a assinatura de onUpdated viva
// enquanto a área de arquitetura estiver montada. Re-carrega quando o projeto
// ativo muda. StrictMode-safe (guards no store).
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
    if (activeProjectId) void load(activeProjectId)
  }, [activeProjectId, load])
}
