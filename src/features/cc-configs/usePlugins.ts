import { useCallback, useEffect, useRef, useState } from 'react'
import { ccPluginsApi } from '@/lib/ipc'
import type {
  AvailablePlugin,
  ManagedPluginInfo,
  PluginAction,
  PluginActionResult,
} from '../../../shared/types/ipc'

interface State {
  installed: ManagedPluginInfo[]
  available: AvailablePlugin[]
  loadingInstalled: boolean
  loadingAvailable: boolean
  installedError: string | null
  availableError: string | null
}

const INITIAL: State = {
  installed: [],
  available: [],
  loadingInstalled: false,
  loadingAvailable: false,
  installedError: null,
  availableError: null,
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOENT|not found|command not found/i.test(msg)) {
    return 'CLI do Claude não encontrada. Verifique se `claude` está instalado.'
  }
  return msg || 'Erro inesperado.'
}

export function usePlugins() {
  const [state, setState] = useState<State>(INITIAL)
  const availableLoadedRef = useRef(false)

  const loadInstalled = useCallback(async () => {
    setState((s) => ({ ...s, loadingInstalled: true, installedError: null }))
    try {
      const data = await ccPluginsApi.list()
      setState((s) => ({ ...s, installed: data ?? [], loadingInstalled: false }))
    } catch (err) {
      setState((s) => ({
        ...s,
        loadingInstalled: false,
        installedError: friendlyError(err),
      }))
    }
  }, [])

  const loadAvailable = useCallback(async () => {
    availableLoadedRef.current = true
    setState((s) => ({ ...s, loadingAvailable: true, availableError: null }))
    try {
      const data = await ccPluginsApi.available()
      setState((s) => ({ ...s, available: data ?? [], loadingAvailable: false }))
    } catch (err) {
      setState((s) => ({
        ...s,
        loadingAvailable: false,
        availableError: friendlyError(err),
      }))
    }
  }, [])

  const ensureAvailable = useCallback(() => {
    if (!availableLoadedRef.current) void loadAvailable()
  }, [loadAvailable])

  const runAction = useCallback(
    async (action: PluginAction, name: string): Promise<PluginActionResult> => {
      const result = await ccPluginsApi.action(action, name)
      await loadInstalled()
      if (action === 'install' || action === 'uninstall') {
        await loadAvailable()
      }
      return result
    },
    [loadInstalled, loadAvailable],
  )

  useEffect(() => {
    void loadInstalled()
  }, [loadInstalled])

  return {
    ...state,
    loadInstalled,
    loadAvailable,
    ensureAvailable,
    runAction,
  }
}
