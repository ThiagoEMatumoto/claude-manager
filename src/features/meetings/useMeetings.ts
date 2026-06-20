import { useEffect } from 'react'
import { useMeetingsStore } from '@/store/meetingsStore'

// Carrega a lista no mount e mantém a assinatura de meeting:updated viva enquanto
// a área de reuniões estiver montada. StrictMode-safe (guards no store).
export function useMeetings() {
  const load = useMeetingsStore((s) => s.load)
  const startUpdatedWatch = useMeetingsStore((s) => s.startUpdatedWatch)
  const stopUpdatedWatch = useMeetingsStore((s) => s.stopUpdatedWatch)

  useEffect(() => {
    void load()
    startUpdatedWatch()
    return () => stopUpdatedWatch()
  }, [load, startUpdatedWatch, stopUpdatedWatch])
}
