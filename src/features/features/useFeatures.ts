import { useEffect } from 'react'
import { useFeaturesStore } from '@/store/featuresStore'

// Carrega a lista no mount e mantém a assinatura de onUpdated viva enquanto a
// área de features estiver montada. StrictMode-safe (guards no store).
export function useFeatures() {
  const load = useFeaturesStore((s) => s.load)
  const startUpdatedWatch = useFeaturesStore((s) => s.startUpdatedWatch)
  const stopUpdatedWatch = useFeaturesStore((s) => s.stopUpdatedWatch)

  useEffect(() => {
    void load()
    startUpdatedWatch()
    return () => stopUpdatedWatch()
  }, [load, startUpdatedWatch, stopUpdatedWatch])
}
