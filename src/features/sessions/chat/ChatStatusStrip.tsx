import type { SessionActivity } from '../../../../shared/types/ipc'

interface Props {
  status?: SessionActivity['status']
  // Último subagente do transcript + se terminou em erro (derivado do tool_result
  // do Task). Dado real do transcript; ausente = sem subagente recente.
  subagentName?: string | null
  subagentError?: boolean
}

// Rótulo de estado no vocabulário da casa (engenheiro de pista). accent = é a vez
// do usuário (no box). Mantém a métrica de custo fora daqui: o ChatView não recebe
// o custo do stint, e a casa não inventa números.
function stateLabel(status: Props['status']): { text: string; turn: boolean } {
  switch (status) {
    case 'waiting':
      return { text: 'NO BOX · SUA VEZ', turn: true }
    case 'working':
      return { text: 'EM PISTA', turn: false }
    case 'starting':
      return { text: 'ENTRANDO NO BOX', turn: false }
    case 'ended':
      return { text: 'ENCERRADA', turn: false }
    default:
      return { text: 'NA GARAGEM', turn: false }
  }
}

// Faixa de estado (~26px) abaixo do transcript: à esquerda o estado no vocabulário
// da casa + subagente recente. Dot estático de propósito — o único ApexDot
// pulsante da vista é o do card de decisão ativo.
export function ChatStatusStrip({ status, subagentName, subagentError }: Props) {
  const { text, turn } = stateLabel(status)
  return (
    <div className="flex h-[26px] flex-shrink-0 items-center gap-2.5 border-t border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] px-3.5 font-mono text-[10px] text-[var(--color-text-dim)]">
      <span
        className={`flex items-center gap-1.5 ${turn ? 'text-[var(--color-accent)]' : ''}`}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: turn ? 'var(--color-accent)' : 'var(--color-text-dim)' }}
        />
        {text}
      </span>
      {subagentName && (
        <>
          <span className="text-[var(--color-border)]">|</span>
          <span className="flex items-center gap-1 truncate">
            {subagentName}
            <span
              className={subagentError ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}
            >
              {subagentError ? '✕' : '✓'}
            </span>
          </span>
        </>
      )}
    </div>
  )
}
