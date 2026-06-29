import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Clock, Loader, Sparkles } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import type { SessionActivity } from '../../../shared/types/ipc'
import type { PendingSelection } from './model-queue'

// Whitelists literais — são a ÚNICA fonte do que pode ser injetado no PTY
// (/model e /effort). Nunca interpolar texto livre nesses comandos.
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku'] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

const MODEL_LABELS: Record<ModelAlias, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
}

// Mapeia o model id completo do transcript (ex: 'claude-opus-4-5-...') pro
// alias exibível, por substring. Ids desconhecidos (ou '<synthetic>') → null.
export function modelAliasFromId(id: string | null | undefined): ModelAlias | null {
  if (!id) return null
  const lower = id.toLowerCase()
  for (const alias of MODEL_ALIASES) {
    if (lower.includes(alias)) return alias
  }
  return null
}

// Troca otimista: se o transcript não confirmar o modelo alvo em 20s, o pill
// reverte pro detectado (a injeção pode ter sido ignorada pelo claude).
const SWITCH_TIMEOUT_MS = 20_000

interface Props {
  activity: SessionActivity | null
  /** Sessão ociosa — único estado em que é seguro injetar /model | /effort. */
  canSwitch: boolean
  /** Troca escolhida enquanto a sessão estava ocupada, aguardando o próximo idle. */
  pending: PendingSelection
  onSelectModel: (alias: ModelAlias) => void
}

export function ModelPill({ activity, canSwitch, pending, onSelectModel }: Props) {
  const [open, setOpen] = useState(false)
  // Alvo da troca otimista de modelo; null = sem troca em voo.
  const [switching, setSwitching] = useState<ModelAlias | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const detected = modelAliasFromId(activity?.model)

  // Confirmação: quando o transcript reporta o modelo alvo, a troca terminou.
  useEffect(() => {
    if (switching && detected === switching) {
      setSwitching(null)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [switching, detected])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function pickModel(alias: ModelAlias) {
    onSelectModel(alias)
    // Otimismo só quando vai injetar agora; em busy a pendência (prop) é a fonte.
    if (canSwitch) {
      setSwitching(alias)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setSwitching(null), SWITCH_TIMEOUT_MS)
    }
  }

  const hasPending = pending.model !== undefined

  const sections: MenuSection[] = [
    {
      title: 'Modelo',
      items: MODEL_ALIASES.map((alias) => ({
        label: MODEL_LABELS[alias],
        active: (switching ?? pending.model ?? detected) === alias,
        onClick: () => pickModel(alias),
      })),
    },
  ]

  // Label do pill: pendência (busy) > troca em voo > alias detectado > id cru > 'modelo…'.
  let label: string
  let dim = false
  if (pending.model) {
    label = MODEL_LABELS[pending.model]
  } else if (switching) {
    label = MODEL_LABELS[switching]
  } else if (detected) {
    label = MODEL_LABELS[detected]
  } else if (activity?.model) {
    label = activity.model.replace(/^claude-/, '')
  } else {
    label = 'modelo…'
    dim = true
  }

  return (
    <Menu open={open} onClose={() => setOpen(false)} sections={sections}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          canSwitch
            ? 'Trocar modelo ou esforço desta sessão'
            : 'Sessão ocupada — a troca será aplicada quando ela ficar ociosa'
        }
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)] ${
          hasPending ? 'border-[var(--color-accent)]/50' : 'border-[var(--color-border)]'
        } ${dim ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text)]'}`}
      >
        <Icon
          as={switching ? Loader : hasPending ? Clock : Sparkles}
          size={11}
          className={switching ? 'animate-spin' : 'text-[var(--color-accent)]'}
        />
        <span className="whitespace-nowrap">{label}</span>
        <Icon as={ChevronDown} size={10} className="text-[var(--color-text-dim)]" />
      </button>
    </Menu>
  )
}
