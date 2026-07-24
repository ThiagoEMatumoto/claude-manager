import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { useIntroGate, planDuration, INTRO_MAX_MS, INTRO_MIN_MS, INTRO_EXIT_MS } from './useIntroGate'
import type { IntroScene, IntroSceneHandle } from './scenes/types'

describe('planDuration', () => {
  it('respeita o arco mínimo quando o boot é instantâneo', () => {
    expect(planDuration(0)).toBe(INTRO_MIN_MS)
  })

  it('dá à cena o rabo do ato final quando o boot é intermediário', () => {
    // 2000ms de boot + 600ms de tail = 2600, dentro do teto.
    expect(planDuration(2000)).toBe(2600)
  })

  it('não passa do teto nem com boot lento', () => {
    expect(planDuration(2900)).toBe(INTRO_MAX_MS)
    expect(planDuration(60_000)).toBe(INTRO_MAX_MS)
  })

  it('usa o teto quando o boot nunca termina', () => {
    expect(planDuration(null)).toBe(INTRO_MAX_MS)
  })
})

function makeScene() {
  const handle: IntroSceneHandle = {
    render: vi.fn(),
    setPointer: vi.fn(),
    resize: vi.fn(),
    release: vi.fn(),
    dispose: vi.fn(),
  }
  const scene: IntroScene = {
    id: 'lights-out',
    label: 'Lights Out',
    blurb: 'teste',
    mount: vi.fn(() => handle),
  }
  return { scene, handle }
}

/** Monta o gate com um canvas de verdade preso ao ref, como o overlay faz. */
function Harness(props: {
  scene: IntroScene | null
  ready: boolean
  onDone?: () => void
  onState?: (s: { phase: string; reduced: boolean }) => void
}) {
  const { canvasRef, phase, reduced } = useIntroGate({
    scene: props.scene,
    ready: props.ready,
    onDone: props.onDone,
  })
  props.onState?.({ phase, reduced })
  return phase === 'done' ? null : <canvas ref={canvasRef} data-testid="intro-canvas" />
}

describe('useIntroGate', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'],
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('segura até o teto quando o boot nunca fica pronto, e só então libera', () => {
    const { scene, handle } = makeScene()
    const onDone = vi.fn()
    render(<Harness scene={scene} ready={false} onDone={onDone} />)

    act(() => {
      vi.advanceTimersByTime(INTRO_MIN_MS + 200)
    })
    // Passou do arco mínimo, mas o boot não terminou: a intro continua.
    expect(onDone).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(INTRO_MAX_MS)
    })
    expect(handle.release).toHaveBeenCalled()
    // O fade-out só é agendado depois do React reconciliar a transição de fase.
    act(() => {
      vi.advanceTimersByTime(INTRO_EXIT_MS + 50)
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('não encurta abaixo do arco mínimo quando o boot é instantâneo', () => {
    const { scene } = makeScene()
    const onDone = vi.fn()
    render(<Harness scene={scene} ready={true} onDone={onDone} />)

    act(() => {
      vi.advanceTimersByTime(INTRO_MIN_MS - 300)
    })
    expect(onDone).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(600)
    })
    act(() => {
      vi.advanceTimersByTime(INTRO_EXIT_MS + 50)
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('avisa a cena do ato final antes de terminar', () => {
    const { scene, handle } = makeScene()
    render(<Harness scene={scene} ready={true} />)

    act(() => {
      vi.advanceTimersByTime(INTRO_MIN_MS)
    })
    expect(handle.release).toHaveBeenCalledTimes(1)

    // release é one-shot, mesmo com o loop de rAF continuando.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(handle.release).toHaveBeenCalledTimes(1)
  })

  it('pula com o teclado e mata a cena', () => {
    const { scene, handle } = makeScene()
    const onDone = vi.fn()
    render(<Harness scene={scene} ready={false} onDone={onDone} />)

    act(() => {
      vi.advanceTimersByTime(300)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(onDone).toHaveBeenCalled()
    expect(handle.dispose).toHaveBeenCalled()
  })

  it('pula com o clique', () => {
    const { scene } = makeScene()
    const onDone = vi.fn()
    render(<Harness scene={scene} ready={false} onDone={onDone} />)

    act(() => {
      vi.advanceTimersByTime(300)
      window.dispatchEvent(new Event('pointerdown'))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('libera o contexto WebGL ao desmontar mesmo no meio da cena', () => {
    const { scene, handle } = makeScene()
    const { unmount } = render(<Harness scene={scene} ready={false} />)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    unmount()
    expect(handle.dispose).toHaveBeenCalled()
  })

  it('não monta WebGL sob prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList,
    )
    const { scene } = makeScene()
    const onDone = vi.fn()
    render(<Harness scene={scene} ready={true} onDone={onDone} />)

    expect(scene.mount).not.toHaveBeenCalled()

    // E o fallback é curto: crossfade, não os 1.6s do arco completo.
    act(() => {
      vi.advanceTimersByTime(700)
    })
    act(() => {
      vi.advanceTimersByTime(INTRO_EXIT_MS + 50)
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('cai no fallback estático quando a cena explode no mount', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene: IntroScene = {
      id: 'lights-out',
      label: 'Lights Out',
      blurb: 'teste',
      mount: vi.fn(() => {
        throw new Error('WebGL indisponível')
      }),
    }
    const onDone = vi.fn()
    render(<Harness scene={scene} ready={true} onDone={onDone} />)

    // O usuário não fica preso atrás de um overlay morto.
    act(() => {
      vi.advanceTimersByTime(700)
    })
    act(() => {
      vi.advanceTimersByTime(INTRO_EXIT_MS + 50)
    })
    expect(onDone).toHaveBeenCalled()
  })
})
