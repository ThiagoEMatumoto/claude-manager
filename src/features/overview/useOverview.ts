import { useEffect } from 'react'
import { useOverviewStore } from '@/store/overviewStore'

// Carrega o agregado no mount e mantém o watch dos 3 canais (objetivos,
// tarefas, features) vivo enquanto a área estiver montada. StrictMode-safe
// (guards no store), mesmo padrão de useObjectives/useTasks.
export function useOverview() {
  const load = useOverviewStore((s) => s.load)
  const startWatch = useOverviewStore((s) => s.startWatch)
  const stopWatch = useOverviewStore((s) => s.stopWatch)

  useEffect(() => {
    void load()
    startWatch()
    return () => stopWatch()
  }, [load, startWatch, stopWatch])
}
