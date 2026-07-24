import { useEffect, useRef, useState } from 'react'
import { useIntroGate } from './useIntroGate'
import { Wordmark } from './Wordmark'
import { INTRO_SCENES } from './scenes'
import type { IntroScene } from './scenes/types'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

/**
 * Comparador das variantes de abertura. Existe só até a escolha ser feita —
 * depois some junto com as cenas descartadas. Roda em loop, no hardware real,
 * porque é o único lugar onde dá pra julgar 60fps honestamente.
 */
export function IntroGallery({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(2)
  const [runId, setRunId] = useState(0)
  const scene = INTRO_SCENES[index]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'r' || e.key === 'R') return setRunId((n) => n + 1)
      if (e.key === 'ArrowLeft') return setSpeedIdx((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') return setSpeedIdx((i) => Math.min(SPEEDS.length - 1, i + 1))
      const n = Number(e.key)
      if (n >= 1 && n <= INTRO_SCENES.length) setIndex(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[200]" style={{ background: 'var(--color-bg)' }}>
      <Stage key={`${scene.id}-${runId}`} scene={scene} speed={SPEEDS[speedIdx]} />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-5"
        style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 11 }}
      >
        <div className="flex flex-col gap-1.5">
          {INTRO_SCENES.map((s, i) => (
            <div
              key={s.id}
              className="flex items-baseline gap-2"
              style={{ color: i === index ? 'var(--color-text)' : 'var(--color-text-dim)' }}
            >
              <span style={{ color: i === index ? 'var(--color-accent)' : undefined }}>
                [{i + 1}]
              </span>
              <span className="font-bold tracking-wider">{s.label}</span>
              <span style={{ color: 'var(--color-text-dim)', opacity: 0.75 }}>{s.blurb}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-end gap-1.5" style={{ color: 'var(--color-text-dim)' }}>
          <Fps />
          <span>{SPEEDS[speedIdx]}× &nbsp;←/→</span>
          <span>R replay &nbsp;·&nbsp; Esc sair</span>
        </div>
      </div>
    </div>
  )
}

function Stage({ scene, speed }: { scene: IntroScene; speed: number }) {
  // ready=true + loop: a cena roda seu arco mínimo inteiro e recomeça, então dá
  // pra assistir o ciclo completo sem depender do boot.
  const { canvasRef, progress } = useIntroGate({ scene, ready: true, loop: true, speed })
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <Wordmark reveal={progress} />
    </>
  )
}

function Fps() {
  const [fps, setFps] = useState(0)
  const ref = useRef({ frames: 0, since: 0 })

  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      const s = ref.current
      if (!s.since) s.since = now
      s.frames++
      if (now - s.since >= 500) {
        setFps(Math.round((s.frames * 1000) / (now - s.since)))
        s.frames = 0
        s.since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <span style={{ color: fps && fps < 55 ? 'var(--color-warning)' : 'var(--color-text-dim)' }}>
      {fps} fps
    </span>
  )
}

export default IntroGallery
