import { ArrowLeft, ArrowRight, Check, Cpu } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { TuiModelOption } from '../tui-picker-parser'

interface Props {
  options: TuiModelOption[]
  highlightIndex: number
  effortLabel?: string
  // Clique numa opção: navega (setas) até ela + Enter aplica — ver
  // buildPickerSelectKeys. Ausente = read-only.
  onSelect?: (optionIndex: number) => void
  onEffort?: (direction: 'left' | 'right') => void
  onApply?: () => void
  onCancel?: () => void
  sent?: boolean
}

// Picker de /model: navegação validada é por SETA (não dígito) — clicar numa
// opção compõe navegação + Enter (ver respond-keys). Effort é um eixo à parte
// (←/→), sem contagem de níveis validada — os botões só encaminham a seta,
// sem tentar enumerar os níveis possíveis.
export function ModelPickerCard({
  options,
  highlightIndex,
  effortLabel,
  onSelect,
  onEffort,
  onApply,
  onCancel,
  sent,
}: Props) {
  const clickable = !sent
  return (
    <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/60 text-sm">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        <Icon as={Cpu} size={14} className="shrink-0 text-[var(--color-accent)]" />
        <span className="font-medium text-[var(--color-text)]">Selecionar modelo</span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-col gap-1">
          {options.map((opt, oi) => {
            const isHighlighted = oi === highlightIndex
            return (
              <button
                key={oi}
                type="button"
                disabled={!clickable || onSelect == null}
                onClick={() => onSelect?.(opt.index)}
                className={`flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left transition disabled:cursor-default ${
                  isHighlighted
                    ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                }`}
              >
                <Icon
                  as={Check}
                  size={13}
                  className={`mt-0.5 shrink-0 ${opt.current ? 'text-[var(--color-accent)]' : 'text-transparent'}`}
                />
                <div className="min-w-0">
                  <div className="font-medium text-[var(--color-text)]/90">{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-[var(--color-text-dim)]">{opt.description}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {effortLabel && (
          <div className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1.5">
            <button
              type="button"
              disabled={!clickable || onEffort == null}
              onClick={() => onEffort?.('left')}
              className="shrink-0 rounded p-0.5 text-[var(--color-text-dim)] transition hover:text-[var(--color-text)] disabled:opacity-30"
              aria-label="Reduzir effort"
            >
              <Icon as={ArrowLeft} size={13} />
            </button>
            <span className="flex-1 text-xs text-[var(--color-text-dim)]">{effortLabel}</span>
            <button
              type="button"
              disabled={!clickable || onEffort == null}
              onClick={() => onEffort?.('right')}
              className="shrink-0 rounded p-0.5 text-[var(--color-text-dim)] transition hover:text-[var(--color-text)] disabled:opacity-30"
              aria-label="Aumentar effort"
            >
              <Icon as={ArrowRight} size={13} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!clickable || onApply == null}
            onClick={() => onApply?.()}
            className="rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium transition hover:bg-[var(--color-accent)]/25 disabled:opacity-40"
          >
            Aplicar
          </button>
          <button
            type="button"
            disabled={!clickable || onCancel == null}
            onClick={() => onCancel?.()}
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium transition hover:border-[var(--color-danger)]/40 disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
        <div className="text-xs text-[var(--color-text-dim)]">
          {sent ? 'Enviado…' : 'Clique numa opção pra destacar, ajuste o effort e aplique.'}
        </div>
      </div>
    </div>
  )
}
