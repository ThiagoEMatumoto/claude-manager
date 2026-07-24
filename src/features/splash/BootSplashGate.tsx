import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { prefsApi } from '@/lib/ipc'
import { SHOW_INTRO_ON_BOOT_KEY } from '@/lib/session-prefs-store'
import { Splash } from './Splash'

type Phase = 'resolving' | 'intro' | 'done'

// Cobre a janela por ~1 frame enquanto decidimos se mostra a intro — evita um
// flash do app antes da splash (bg igual ao da splash, então é imperceptível).
const cover: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  background: '#050507',
  WebkitAppRegion: 'drag',
} as CSSProperties

// Gate visual de boot. Sempre renderiza o app por baixo (o restore de sessões
// roda no App/store independentemente disto — a splash é um overlay, nunca
// bloqueia o boot). Decide exibir a intro lendo a pref + prefers-reduced-motion.
export function BootSplashGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('resolving')
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const reduced =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      let show = !reduced
      if (show) {
        try {
          const raw = await prefsApi.get<boolean>(SHOW_INTRO_ON_BOOT_KEY)
          show = raw !== false
        } catch {
          show = true
        }
      }
      if (!cancelled) setPhase(show ? 'intro' : 'done')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleFinish = () => {
    setExiting(true)
    // Deixa a transição de opacity (0.32s no CSS) rodar antes de desmontar.
    setTimeout(() => setPhase('done'), 320)
  }

  return (
    <>
      {children}
      {phase === 'resolving' && <div style={cover} />}
      {phase === 'intro' && <Splash onFinish={handleFinish} exiting={exiting} />}
    </>
  )
}
