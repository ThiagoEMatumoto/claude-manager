import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionsApi } from '@/lib/ipc'
import type { Session, PtyDataEvent, PtyExitEvent } from '../../../shared/types/ipc'

interface State {
  session: Session | null
  exited: boolean
  exitCode: number | null
  error: string | null
}

const INITIAL: State = {
  session: null,
  exited: false,
  exitCode: null,
  error: null,
}

type DataHandler = (data: string) => void

export function useSession(repoId: string | null) {
  const [state, setState] = useState<State>(INITIAL)
  const sessionIdRef = useRef<string | null>(null)
  const dataHandlerRef = useRef<DataHandler | null>(null)

  useEffect(() => {
    sessionIdRef.current = state.session?.id ?? null
  }, [state.session])

  // Registrar o sink de dados ANTES de spawnar evita perder os primeiros bytes
  // que o PTY emite (ex: o banner inicial do claude) antes do React montar o xterm.
  const setDataHandler = useCallback((handler: DataHandler | null) => {
    dataHandlerRef.current = handler
  }, [])

  const start = useCallback(
    async (cols?: number, rows?: number) => {
      if (!repoId) return
      setState(INITIAL)
      try {
        const session = await sessionsApi.spawn({ repoId, cols, rows })
        setState((s) => ({ ...s, session }))
      } catch (err) {
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
      }
    },
    [repoId],
  )

  const write = useCallback((data: string) => {
    const id = sessionIdRef.current
    if (!id) return
    void sessionsApi.write(id, data)
  }, [])

  const kill = useCallback(() => {
    const id = sessionIdRef.current
    if (!id) return
    void sessionsApi.kill(id)
  }, [])

  const resize = useCallback((cols: number, rows: number) => {
    const id = sessionIdRef.current
    if (!id) return
    void sessionsApi.resize(id, cols, rows)
  }, [])

  useEffect(() => {
    const offData = sessionsApi.onData((e: PtyDataEvent) => {
      if (e.sessionId !== sessionIdRef.current) return
      dataHandlerRef.current?.(e.data)
    })
    const offExit = sessionsApi.onExit((e: PtyExitEvent) => {
      if (e.sessionId !== sessionIdRef.current) return
      setState((s) => ({ ...s, exited: true, exitCode: e.exitCode }))
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  return { ...state, start, write, kill, resize, setDataHandler }
}
