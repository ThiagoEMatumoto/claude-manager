import { useCallback, useState } from 'react'
import { useIntroGate, INTRO_EXIT_MS } from './useIntroGate'
import { Wordmark } from './Wordmark'
import type { IntroScene } from './scenes/types'

export type IntroOverlayProps = {
  scene: IntroScene | null
  /** O boot terminou. Enquanto false, a intro segura (até o teto de 3s). */
  ready: boolean
  onDone?: () => void
}

/**
 * Cobre a janela inteira — inclusive a titlebar frameless — enquanto o app
 * termina de montar. z-100 fica acima de tudo que o app usa; o bg casa com o
 * backgroundColor da BrowserWindow, então não há flash entre o frame nativo e
 * a intro.
 */
export function IntroOverlay({ scene, ready, onDone }: IntroOverlayProps) {
  const [gone, setGone] = useState(false)
  const handleDone = useCallback(() => {
    setGone(true)
    onDone?.()
  }, [onDone])

  const { canvasRef, phase, progress, reduced } = useIntroGate({
    scene,
    ready,
    onDone: handleDone,
  })

  if (gone || phase === 'done') return null

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100]"
      style={{
        background: 'var(--color-bg)',
        opacity: phase === 'exiting' ? 0 : 1,
        transition: `opacity ${INTRO_EXIT_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    >
      {!reduced && <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />}
      {/* Sob reduced-motion não há cena para acompanhar: o wordmark já entra pronto. */}
      <Wordmark reveal={reduced ? 1 : progress} />
    </div>
  )
}
