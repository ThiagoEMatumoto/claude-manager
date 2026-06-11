import { useEffect, useState } from 'react'
import { metricsApi } from '@/lib/ipc'
import type { MetricsSnapshot } from '../../../shared/types/ipc'

// Snapshot de métricas da Home (janela 30d), com estado local — NÃO usa o
// useMetricsStore pra não brigar com a janela selecionada na área Metrics.
// Após o primeiro paint dispara um refresh (rescan) fire-and-forget no máximo
// 1×/boot e re-busca o snapshot quando ele conclui.
let refreshedThisBoot = false

export function useHomeMetrics(): { snapshot: MetricsSnapshot | null; loading: boolean } {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const snap = await metricsApi.get('30d')
        if (!cancelled) setSnapshot(snap)
      } catch {
        // sem métricas (ex: sem transcripts) — a Home segue sem a faixa de uso.
      } finally {
        if (!cancelled) setLoading(false)
      }

      if (refreshedThisBoot) return
      refreshedThisBoot = true
      try {
        await metricsApi.refresh()
        const fresh = await metricsApi.get('30d')
        if (!cancelled) setSnapshot(fresh)
      } catch {
        // refresh falhou — o snapshot inicial (cache) continua valendo.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return { snapshot, loading }
}
