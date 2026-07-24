import { useCallback, useEffect, useRef, useState } from 'react'
import type { IntroScene, IntroSceneHandle } from './scenes/types'

export const INTRO_MIN_MS = 1600
export const INTRO_MAX_MS = 3000
/** Tempo que a cena precisa, depois do release, para fechar o ato final. */
export const INTRO_TAIL_MS = 600
export const INTRO_EXIT_MS = 250
/** Sem WebGL / reduced-motion: só o crossfade do wordmark estático. */
export const INTRO_REDUCED_MS = 400

export type IntroPhase = 'running' | 'exiting' | 'done'

export type IntroGateOptions = {
  scene: IntroScene | null
  /** O boot terminou. Enquanto false, a intro segura (até o teto). */
  ready: boolean
  /** Galeria: reinicia em vez de morrer. */
  loop?: boolean
  onDone?: () => void
  /** Multiplicador de tempo da galeria (0.25×–2×). */
  speed?: number
}

/**
 * Planejamento do arco:
 *
 *   duração = maxMs, até o boot terminar.
 *   quando o boot termina em T: duração = clamp(max(T + tail, minMs), minMs, maxMs)
 *
 * Ou seja: boot rápido não encurta a cena abaixo do arco mínimo, boot lento não
 * a estica além do teto, e em ambos os casos a cena ganha o rabo que precisa pra
 * fechar. Uma vez planejada, a duração não muda mais — a cena não sofre
 * re-timing no meio do movimento.
 */
export function planDuration(
  readyAtMs: number | null,
  { min = INTRO_MIN_MS, max = INTRO_MAX_MS, tail = INTRO_TAIL_MS } = {},
): number {
  if (readyAtMs === null) return max
  return Math.min(Math.max(readyAtMs + tail, min), max)
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

export function useIntroGate({ scene, ready, loop, onDone, speed = 1 }: IntroGateOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<IntroPhase>('running')
  // Fixado no mount: virar reduced-motion no meio da intro não deve remontar nada.
  const [reduced] = useState(prefersReducedMotion)
  /** 0→1, exposto pro wordmark DOM acompanhar a cena. */
  const [progress, setProgress] = useState(0)

  const handleRef = useRef<IntroSceneHandle | null>(null)
  const phaseRef = useRef<IntroPhase>('running')
  const speedRef = useRef(speed)
  speedRef.current = speed
  const readyRef = useRef(ready)
  readyRef.current = ready

  const toPhase = useCallback((next: IntroPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const skip = useCallback(() => {
    if (phaseRef.current !== 'running') return
    toPhase('exiting')
  }, [toPhase])

  // Ciclo de vida da cena + relógio. Roda uma vez; `ready` e `speed` entram por
  // ref pra não remontar a cena (remontar = perder o contexto WebGL no meio).
  useEffect(() => {
    let raf = 0
    let disposed = false

    // O canvas some do DOM no fallback; sem cena, o gate vira só um timer.
    const canvas = reduced ? null : canvasRef.current
    let handle: IntroSceneHandle | null = null

    if (scene && canvas) {
      const root = getComputedStyle(document.documentElement)
      const read = (name: string, fallback: string) =>
        root.getPropertyValue(name).trim() || fallback
      try {
        handle = scene.mount(canvas, {
          accent: read('--color-accent', '#ff7a45'),
          bg: read('--color-bg', '#0b0b0f'),
          dpr: Math.min(window.devicePixelRatio || 1, 2),
        })
      } catch (err) {
        // GPU indisponível, contexto perdido, driver quebrado: cai no estático
        // em vez de deixar o usuário travado atrás de um overlay morto.
        console.warn('[intro] cena não montou, usando fallback estático', err)
        handle = null
      }
    }
    handleRef.current = handle

    const total = handle ? null : INTRO_REDUCED_MS
    let readyAt: number | null = null
    let released = false
    let planned = total ?? INTRO_MAX_MS
    let virtual = 0
    let last = performance.now()

    // Ponteiro: a cena recebe suavizado, senão o parallax fica nervoso.
    let px = 0
    let py = 0
    let tx = 0
    let ty = 0
    const onPointerMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1
      ty = (e.clientY / window.innerHeight) * 2 - 1
    }

    const onResize = () => {
      if (canvas) handle?.resize(canvas.clientWidth, canvas.clientHeight)
    }

    const tick = (now: number) => {
      if (disposed) return
      // 'done' é o fim da linha: sem isso o rAF e o contexto WebGL sobrevivem ao
      // overlay e ficam queimando GPU atrás do app pelo resto da sessão.
      if (phaseRef.current === 'done') {
        handleRef.current?.dispose()
        handleRef.current = null
        return
      }
      // Capado em 50ms: voltar de uma aba escondida não deve teleportar a cena.
      const dt = Math.min((now - last) / 1000, 0.05) * speedRef.current
      last = now
      virtual += dt * 1000

      if (readyAt === null && readyRef.current) {
        readyAt = virtual
        planned = total ?? planDuration(readyAt)
      }

      const t = planned > 0 ? Math.min(virtual / planned, 1) : 1
      setProgress(t)

      if (!released && virtual >= planned - INTRO_TAIL_MS) {
        released = true
        handle?.release()
      }

      if (handle) {
        px += (tx - px) * Math.min(dt * 4, 1)
        py += (ty - py) * Math.min(dt * 4, 1)
        handle.setPointer(px, py)
        handle.render({ t, dt, elapsed: virtual })
      }

      if (virtual >= planned && phaseRef.current === 'running') {
        if (loop) {
          virtual = 0
          released = false
          readyAt = null
          planned = total ?? INTRO_MAX_MS
        } else {
          toPhase('exiting')
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('resize', onResize)
    onResize()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', onResize)
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, [scene, reduced, loop, toPhase])

  // Skip: qualquer sinal de intenção do usuário mata a intro.
  useEffect(() => {
    if (loop) return
    const opts = { capture: true } as const
    window.addEventListener('keydown', skip, opts)
    window.addEventListener('pointerdown', skip, opts)
    window.addEventListener('wheel', skip, opts)
    return () => {
      window.removeEventListener('keydown', skip, opts)
      window.removeEventListener('pointerdown', skip, opts)
      window.removeEventListener('wheel', skip, opts)
    }
  }, [skip, loop])

  // Fade-out → morte.
  useEffect(() => {
    if (phase !== 'exiting') return
    const id = setTimeout(() => {
      toPhase('done')
      onDone?.()
    }, INTRO_EXIT_MS)
    return () => clearTimeout(id)
  }, [phase, onDone, toPhase])

  // Solta a GPU assim que a intro morre, sem esperar o overlay desmontar. O
  // guard no tick é a segunda linha de defesa; esta é a determinística.
  useEffect(() => {
    if (phase !== 'done') return
    handleRef.current?.dispose()
    handleRef.current = null
  }, [phase])

  return { canvasRef, phase, progress, reduced, skip }
}
