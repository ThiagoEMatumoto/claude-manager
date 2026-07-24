import { useId } from 'react'

// Estados do símbolo da marca (metáfora do muro de boxes da F1):
// - em-pista:   muro fechado (1 barra) — agente trabalhando, sem parada.
// - box-aberto: 2 muros + dot com anel pulsante — agente no box, sua vez.
// - fila:       dot + 2 dots menores acima — 3+ agentes aguardando.
// - bandeira:   dot coral — erro/atenção.
export type PitwallLogoState = 'em-pista' | 'box-aberto' | 'fila' | 'bandeira'

interface Props {
  state?: PitwallLogoState
  size?: number
  className?: string
  title?: string
}

const FLAG_COLOR = '#ff8d75'

// Muros herdam a cor do contexto (currentColor); o dot usa o gradiente da marca
// (accent2 → accent), exceto em "bandeira", onde vira coral sólido. As animações
// (pw-pulse/pw-ring) são desligadas em prefers-reduced-motion pelo index.css.
export function PitwallLogo({ state = 'box-aberto', size = 44, className, title }: Props) {
  const gradientId = useId()
  const dotFill = state === 'bandeira' ? FLAG_COLOR : `url(#${gradientId})`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 44 44"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fd6f2" />
          <stop offset="1" stopColor="#9d8cff" />
        </linearGradient>
      </defs>

      {state === 'em-pista' ? (
        // Muro fechado: uma barra única atravessa o vão.
        <rect x="4" y="19.5" width="36" height="5" rx="2.5" fill="currentColor" />
      ) : (
        // 2 muros com vão para o dot.
        <>
          <rect x="4" y="19.5" width="11.5" height="5" rx="2.5" fill="currentColor" />
          <rect x="28.5" y="19.5" width="11.5" height="5" rx="2.5" fill="currentColor" />
        </>
      )}

      {state === 'box-aberto' && (
        <circle
          cx="22"
          cy="22"
          r="3.4"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.5"
          className="pw-ring"
          style={{ transformOrigin: '22px 22px' }}
        />
      )}

      {state === 'fila' && (
        <>
          <circle cx="17" cy="14" r="1.8" fill="currentColor" opacity="0.55" />
          <circle cx="27" cy="14" r="1.8" fill="currentColor" opacity="0.55" />
        </>
      )}

      <circle
        cx="22"
        cy="22"
        r="3.4"
        fill={dotFill}
        className={state === 'box-aberto' ? 'pw-pulse' : undefined}
        style={state === 'box-aberto' ? { transformOrigin: '22px 22px' } : undefined}
      />
    </svg>
  )
}
