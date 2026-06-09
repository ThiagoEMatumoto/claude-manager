import { useEffect } from 'react'
import { useObjectivesStore } from '@/store/objectivesStore'

// Carrega a lista no mount e mantém a assinatura de onUpdated viva enquanto a
// área de objetivos estiver montada. StrictMode-safe (guards no store).
export function useObjectives() {
  const load = useObjectivesStore((s) => s.load)
  const startUpdatedWatch = useObjectivesStore((s) => s.startUpdatedWatch)
  const stopUpdatedWatch = useObjectivesStore((s) => s.stopUpdatedWatch)

  useEffect(() => {
    void load()
    startUpdatedWatch()
    return () => stopUpdatedWatch()
  }, [load, startUpdatedWatch, stopUpdatedWatch])
}
