import { useEffect } from 'react'
import { useTasksStore } from '@/store/tasksStore'

// Carrega a lista no mount e mantém a assinatura de onUpdated viva enquanto a
// área de tarefas estiver montada. StrictMode-safe (guards no store).
export function useTasks() {
  const load = useTasksStore((s) => s.load)
  const startUpdatedWatch = useTasksStore((s) => s.startUpdatedWatch)
  const stopUpdatedWatch = useTasksStore((s) => s.stopUpdatedWatch)

  useEffect(() => {
    void load()
    startUpdatedWatch()
    return () => stopUpdatedWatch()
  }, [load, startUpdatedWatch, stopUpdatedWatch])
}
