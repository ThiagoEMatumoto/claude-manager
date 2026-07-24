import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/features/brand'
import { useAppStore } from '@/store/appStore'
import { useSessionPrefsStore } from '@/lib/session-prefs-store'
import './Splash.css'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

// Traçado orgânico de um circuito, fechado (Z). pathLength=2600 normaliza o
// comprimento pro stroke-dasharray do "desenho". O carro (SMIL) segue este mesmo
// path por id.
const TRACK_PATH =
  'M 175 300 C 150 200 250 130 360 150 C 445 165 470 110 560 120 C 680 133 760 200 745 300 ' +
  'C 733 380 640 375 570 405 C 500 435 460 470 370 458 C 285 447 250 415 235 380 ' +
  'C 220 345 200 360 175 300 Z'

const ANIM_TOTAL_MS = 6100
const TICKS = [0, 1, 2, 3, 4, 5]

interface Props {
  onFinish: () => void
  exiting?: boolean
}

export function Splash({ onFinish, exiting }: Props) {
  const bootSessionCount = useAppStore((s) => s.bootSessionCount)
  const restoreComplete = useAppStore((s) => s.restoreComplete)
  const setShowIntroOnBoot = useSessionPrefsStore((s) => s.setShowIntroOnBoot)

  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  )
  // Remonta a subárvore animada (SVG + timeline) pra o botão Repetir.
  const [runKey, setRunKey] = useState(0)
  const [animationDone, setAnimationDone] = useState(reduced)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const finishedRef = useRef(false)

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinish()
  }

  // Marca o fim da animação (libera CTAs / auto-advance). Reduced motion já entra
  // com animationDone=true. Rearma no replay.
  useEffect(() => {
    if (reduced) {
      setAnimationDone(true)
      return
    }
    setAnimationDone(false)
    const t = setTimeout(() => setAnimationDone(true), ANIM_TOTAL_MS)
    return () => clearTimeout(t)
  }, [reduced, runKey])

  // Auto-avança quando a animação já passou E o restore terminou. Nunca antes —
  // "Entrar no box" e "Pular" seguem disponíveis pro usuário decidir.
  useEffect(() => {
    if (!animationDone || !restoreComplete) return
    const t = setTimeout(finish, 500)
    return () => clearTimeout(t)
  }, [animationDone, restoreComplete])

  // Enter entra no box; Escape pula. Ambos sempre ativos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const onToggleDontShow = (checked: boolean) => {
    setDontShowAgain(checked)
    void setShowIntroOnBoot(!checked)
  }

  const statusText =
    bootSessionCount == null ? (
      <>restaurando sessões…</>
    ) : bootSessionCount === 0 ? (
      <>abrindo o box · nada a restaurar</>
    ) : (
      <>
        abrindo o box · restaurando <b>{bootSessionCount}</b>{' '}
        {bootSessionCount === 1 ? 'sessão' : 'sessões'}
      </>
    )

  return (
    <div className="spl-root" style={drag} data-reduced={reduced} data-exiting={exiting}>
      <button className="spl-skip" style={noDrag} onClick={finish} type="button">
        PULAR INTRO →
      </button>

      <div className="spl-stage" key={runKey}>
        <svg className="spl-svg" viewBox="0 0 900 520" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="spl-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--color-accent2)" />
              <stop offset="1" stopColor="var(--color-accent)" />
            </linearGradient>
            <filter id="spl-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Pista base (fantasma) + o traço de gradiente que desenha. */}
          <path
            id="spl-track"
            d={TRACK_PATH}
            pathLength={2600}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <path
            className="spl-track-glow"
            d={TRACK_PATH}
            pathLength={2600}
            fill="none"
            stroke="url(#spl-grad)"
            strokeWidth={2.5}
            strokeLinecap="round"
            filter="url(#spl-glow)"
          />

          {/* O carro: dois dots que percorrem a pista 2 voltas e somem no box.
              SMIL (unidades do viewBox) — só quando não é reduced motion. */}
          {!reduced && (
            <>
              <circle r={8} fill="url(#spl-grad)" filter="url(#spl-glow)" opacity={0}>
                <animate
                  attributeName="opacity"
                  from="0"
                  to="1"
                  begin="0.55s"
                  dur="0.2s"
                  fill="freeze"
                />
                <animateMotion begin="0.55s" dur="0.78s" repeatCount="2" rotate="auto" fill="freeze">
                  <mpath href="#spl-track" />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  from="1"
                  to="0"
                  begin="2.05s"
                  dur="0.35s"
                  fill="freeze"
                />
              </circle>
              <circle r={3} fill="var(--color-accent2)" opacity={0}>
                <animate
                  attributeName="opacity"
                  from="0"
                  to="1"
                  begin="0.55s"
                  dur="0.2s"
                  fill="freeze"
                />
                <animateMotion begin="0.6s" dur="0.78s" repeatCount="2" fill="freeze">
                  <mpath href="#spl-track" />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  from="1"
                  to="0"
                  begin="2.05s"
                  dur="0.35s"
                  fill="freeze"
                />
              </circle>
            </>
          )}

          {/* O box vira a logo: anel pulsante + dot central + 2 muros que abrem. */}
          <circle
            className="spl-ring"
            cx={450}
            cy={305}
            r={16}
            fill="none"
            stroke="url(#spl-grad)"
            strokeWidth={2}
          />
          <circle className="spl-apex" cx={450} cy={305} r={8} fill="url(#spl-grad)" filter="url(#spl-glow)" />
          <rect className="spl-wall spl-wall-l" x={344} y={298.5} width={108} height={13} rx={6.5} fill="#f1f0f6" />
          <rect className="spl-wall spl-wall-r" x={448} y={298.5} width={108} height={13} rx={6.5} fill="#f1f0f6" />
        </svg>
      </div>

      <div className="spl-wordmark">Pitwall</div>
      <div className="spl-subtitle">O COCKPIT DO DEV</div>

      <div className="spl-ruler">
        {TICKS.map((i) => (
          <span
            key={i}
            className="spl-tick"
            style={{ animationDelay: `${5.0 + i * 0.08}s` }}
          />
        ))}
      </div>

      <div className="spl-status">{statusText}</div>

      <div className="spl-ctas" style={noDrag}>
        <Button variant="primary" onClick={finish}>
          Entrar no box
        </Button>
        <Button variant="ghost" onClick={() => setRunKey((k) => k + 1)}>
          ↺ Repetir
        </Button>
      </div>

      <label className="spl-toggle" style={noDrag}>
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => onToggleDontShow(e.target.checked)}
        />
        não mostrar a intro no boot
      </label>

      <div className="spl-caption">o muro se abre · o agente entra em pista</div>
    </div>
  )
}
