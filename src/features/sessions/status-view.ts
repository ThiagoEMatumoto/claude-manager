import type { SessionActivity } from '../../../shared/types/ipc'

// Helpers PUROS de apresentação de status, compartilhados entre o hero
// (SessionHeader) e o AgentHud. Sem React/electron — testáveis no vitest.

export interface StatusDotView {
  label: string
  className: string
  pulse?: boolean
}

// Status vira um dot colorido (mesmas cores de sempre); o texto em caps e o
// tempo relativo migram pro tooltip/aria-label do dot — nada se perde.
export function statusDotView(status: SessionActivity['status'] | undefined): StatusDotView {
  switch (status) {
    case 'working':
      return { label: 'Trabalhando', className: 'text-[var(--color-accent)]', pulse: true }
    case 'waiting':
      return { label: 'Aguardando você', className: 'text-[var(--color-warning)]' }
    case 'idle':
      return { label: 'Ocioso', className: 'text-[var(--color-text-dim)]' }
    case 'starting':
      return { label: 'Iniciando', className: 'text-[var(--color-text-dim)]', pulse: true }
    case 'ended':
      return { label: 'Encerrada', className: 'text-[var(--color-text-dim)]' }
    default:
      return { label: 'Running', className: 'text-[var(--color-success)]' }
  }
}

export function formatRelative(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `há ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.round(m / 60)
  return `há ${h}h`
}

// Nome exibível de subagente no HUD: tira o prefixo de plugin
// ("kaizen-workflow:kz-implementer" → "kz-implementer"). O nome completo
// continua acessível via tooltip (description).
export function shortenAgentName(name: string): string {
  const idx = name.lastIndexOf(':')
  const short = idx >= 0 ? name.slice(idx + 1) : name
  return short || name
}
