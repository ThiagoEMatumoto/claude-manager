import { Check, Palette } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { TuiThemeOption } from '../tui-picker-parser'

interface Props {
  options: TuiThemeOption[]
  highlightIndex: number
  preview?: string
  syntaxTheme?: string
  previewOn: boolean
  onSelect?: (optionIndex: number) => void
  onTogglePreview?: () => void
  onApply?: () => void
  onCancel?: () => void
  sent?: boolean
}

// Picker de /theme: mesmo padrão de navegação por seta do /model. Ctrl+T
// alterna o preview de sintaxe (botão dedicado — validado ao vivo).
export function ThemePickerCard({
  options,
  highlightIndex,
  preview,
  syntaxTheme,
  previewOn,
  onSelect,
  onTogglePreview,
  onApply,
  onCancel,
  sent,
}: Props) {
  const clickable = !sent
  return (
    <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/60 text-sm">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        <Icon as={Palette} size={14} className="shrink-0 text-[var(--color-accent)]" />
        <span className="font-medium text-[var(--color-text)]">Selecionar tema</span>
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
                className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition disabled:cursor-default ${
                  isHighlighted
                    ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                }`}
              >
                <Icon
                  as={Check}
                  size={13}
                  className={`shrink-0 ${opt.current ? 'text-[var(--color-accent)]' : 'text-transparent'}`}
                />
                <span className="font-medium text-[var(--color-text)]/90">{opt.label}</span>
              </button>
            )
          })}
        </div>
        {preview && (
          <pre className="max-h-40 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1.5 font-mono text-xs leading-relaxed text-[var(--color-text)]/90">
            {preview}
          </pre>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!clickable || onTogglePreview == null}
            onClick={() => onTogglePreview?.()}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs transition hover:border-[var(--color-accent)]/40 disabled:opacity-40"
          >
            {previewOn ? 'Desativar preview (ctrl+t)' : 'Ativar preview (ctrl+t)'}
          </button>
          {syntaxTheme && (
            <span className="text-xs text-[var(--color-text-dim)]">{syntaxTheme}</span>
          )}
        </div>
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
          {sent ? 'Enviado…' : 'Clique num tema pra destacar e aplique.'}
        </div>
      </div>
    </div>
  )
}
