import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader, Sparkles } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import type { SessionActivity } from '../../../shared/types/ipc'

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
  onSelectModel: (alias: ModelAlias) => void
  onSelectEffort: (level: EffortLevel) => void
}

export function ModelPill({ activity, canSwitch, onSelectModel, onSelectEffort }: Props) {
  const [open, setOpen] = useState(false)
  // Alvo da troca otimista de modelo; null = sem troca em voo.
  const [switching, setSwitching] = useState<ModelAlias | null>(null)
  // Esforço escolhido pelo usuário nesta pane (otimista, sem confirmação via
  // transcript — o claude não persiste o effort no JSONL).
  const [effort, setEffort] = useState<EffortLevel | null>(null)
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
    setSwitching(alias)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setSwitching(null), SWITCH_TIMEOUT_MS)
  }

  function pickEffort(level: EffortLevel) {
    onSelectEffort(level)
    setEffort(level)
  }

  const sections: MenuSection[] = [
    {
      title: 'Modelo',
      items: MODEL_ALIASES.map((alias) => ({
        label: MODEL_LABELS[alias],
        active: (switching ?? detected) === alias,
        onClick: () => pickModel(alias),
      })),
    },
    {
      title: 'Esforço',
      items: EFFORT_LEVELS.map((level) => ({
        label: level,
        active: effort === level,
        onClick: () => pickEffort(level),
      })),
    },
  ]

  // Label do pill: troca em voo > alias detectado > id cru encurtado > 'modelo…'.
  let label: string
  let dim = false
  if (switching) {
    label = MODEL_LABELS[switching]
  } else if (detected) {
    label = MODEL_LABELS[detected]
  } else if (activity?.model) {
    label = activity.model.replace(/^claude-/, '').slice(0, 16)
  } else {
    label = 'modelo…'
    dim = true
  }
  if (effort) label += ` · ${effort}`

  return (
    <Menu open={open} onClose={() => setOpen(false)} sections={sections}>
      <button
        type="button"
        disabled={!canSwitch}
        onClick={() => setOpen((v) => !v)}
        title={
          canSwitch
            ? 'Trocar modelo ou esforço desta sessão'
            : 'Aguarde a sessão ficar ociosa pra trocar modelo/esforço'
        }
        className={`flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] transition enabled:hover:border-[var(--color-accent)]/50 enabled:hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
          dim ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text)]'
        }`}
      >
        <Icon
          as={switching ? Loader : Sparkles}
          size={11}
          className={switching ? 'animate-spin' : 'text-[var(--color-accent)]'}
        />
        <span className="max-w-32 truncate">{label}</span>
        <Icon as={ChevronDown} size={10} className="text-[var(--color-text-dim)]" />
      </button>
    </Menu>
  )
}
