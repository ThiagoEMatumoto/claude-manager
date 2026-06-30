import type { SessionActivity } from '../../../shared/types/ipc'
import { contextUsage, formatContextUsage } from './model-context-limits'

interface Props {
  activity: SessionActivity | null
}

// Monitor da janela de contexto no header da pane (ambos os modos): "ctx 95k / 1.0M · 10%".
// Lê tokens.context (cache_read + input da última resposta) e o modelo do broadcast
// session:activity. Não renderiza nada sem tokens+modelo (sessão sem 1ª resposta ainda).
export function ContextUsageIndicator({ activity }: Props) {
  const usage = contextUsage({ tokens: activity?.tokens, model: activity?.model ?? null })
  if (!usage) return null

  const color =
    usage.pct >= 90
      ? 'text-[var(--color-danger)]'
      : usage.pct >= 70
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text-dim)]'

  return (
    <span
      className={`whitespace-nowrap text-[10px] tabular-nums ${color}`}
      title="Janela de contexto usada (cache + input da última resposta) vs. o limite do modelo"
    >
      ctx {formatContextUsage(usage)}
    </span>
  )
}
