import { useCallback, useEffect, useState } from 'react'
import { ccConfigsApi } from '@/lib/ipc'
import type { ClaudeConfigs } from '../../../shared/types/ipc'

const EMPTY: ClaudeConfigs = { plugins: [], agents: [], skills: [], mcps: [], hooks: [] }

export function useCcConfigs() {
  const [configs, setConfigs] = useState<ClaudeConfigs>(EMPTY)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ccConfigsApi.read()
      setConfigs(data ?? EMPTY)
    } catch {
      setConfigs(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { configs, loading, reload }
}
