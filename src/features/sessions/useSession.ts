import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionsApi } from '@/lib/ipc'
import type { Session, PtyDataEvent, PtyExitEvent } from '../../../shared/types/ipc'

interface State {
  session: Session | null
  buffer: string
  exited: boolean
  exitCode: number | null
  error: string | null
}

const INITIAL: State = {
  session: null,
  buffer: '',
  exited: false,
  exitCode: null,
  error: null,
}

export function useSession(repoId: string | null) {
  const [state, setState] = useState<State>(INITIAL)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    sessionIdRef.current = state.session?.id ?? null
  }, [state.session])

  const start = useCallback(async () => {
    if (!repoId) return
    setState(INITIAL)
    try {
      const session = await sessionsApi.spawn({ repoId })
      setState((s) => ({ ...s, session }))
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
    }
  }, [repoId])

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
      setState((s) => ({ ...s, buffer: s.buffer + e.data }))
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

  return { ...state, start, write, kill, resize }
}
