import { useState } from 'react'
import { Search, Settings, SquareCheck, X } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { TuiConfigItem } from '../tui-picker-parser'

interface Props {
  tabs: string[]
  activeTab: string
  searchQuery: string
  searchFocused: boolean
  items: TuiConfigItem[]
  hasMoreBelow: boolean
  // Filtra ao vivo (texto literal — a TUI reage por byte, ver respond-keys).
  onFilter?: (text: string) => void
  // Clique num item true/false: navega até ele + Space alterna. Índice é a
  // posição no array `items` (ordem em que a TUI desenha, filtro já aplicado).
  onToggle?: (itemIndex: number) => void
  onFocusSearch?: () => void
  onClose?: () => void
  sent?: boolean
}

// Picker de /config: só o conteúdo da aba "Settings" foi validado ao vivo —
// as demais abas (Status/Config/Usage/Stats) são mostradas read-only (trocar
// de aba não foi testado, GAP documentado no parser). Toggle só pra valores
// exatamente "true"/"false" (Space, validado); enums ficam não-clicáveis.
export function ConfigCard({
  tabs,
  activeTab,
  searchQuery,
  searchFocused,
  items,
  hasMoreBelow,
  onFilter,
  onToggle,
  onFocusSearch,
  onClose,
  sent,
}: Props) {
  const [draft, setDraft] = useState(searchQuery)
  const clickable = !sent

  function submitFilter() {
    if (draft !== '' && draft !== searchQuery) onFilter?.(draft)
  }

  return (
    <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/60 text-sm">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        <Icon as={Settings} size={14} className="shrink-0 text-[var(--color-accent)]" />
        <span className="font-medium text-[var(--color-text)]">Config</span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {tabs.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {tabs.map((t) => (
              <span
                key={t}
                className={`rounded px-1.5 py-0.5 ${
                  t === activeTab
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-dim)]'
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1.5">
          <Icon as={Search} size={13} className="shrink-0 text-[var(--color-text-dim)]" />
          <input
            type="text"
            value={draft}
            disabled={!clickable || onFilter == null}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFilter()
            }}
            placeholder="Buscar configurações…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
          />
          <button
            type="button"
            disabled={!clickable || onFocusSearch == null}
            onClick={() => onFocusSearch?.()}
            className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-xs disabled:opacity-40"
          >
            /
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {items.map((item, ii) => {
            const isBool = item.value === 'true' || item.value === 'false'
            const content = (
              <>
                {isBool && (
                  <Icon
                    as={SquareCheck}
                    size={13}
                    className={`mt-0.5 shrink-0 ${
                      item.value === 'true' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'
                    }`}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]/90">{item.label}</span>
                <span className="shrink-0 text-xs text-[var(--color-text-dim)]">{item.value}</span>
              </>
            )
            if (isBool && clickable && onToggle != null) {
              return (
                <button
                  key={ii}
                  type="button"
                  onClick={() => onToggle(ii)}
                  className={`flex w-full items-start gap-2 rounded border px-2 py-1 text-left transition hover:border-[var(--color-accent)]/40 ${
                    item.highlighted ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10' : 'border-[var(--color-border)]'
                  }`}
                >
                  {content}
                </button>
              )
            }
            return (
              <div
                key={ii}
                className={`flex items-start gap-2 rounded border px-2 py-1 ${
                  item.highlighted ? 'border-[var(--color-accent)]/60' : 'border-[var(--color-border)]'
                } opacity-90`}
              >
                {content}
              </div>
            )
          })}
          {hasMoreBelow && (
            <div className="px-2 text-xs text-[var(--color-text-dim)]">mais itens abaixo…</div>
          )}
        </div>
        <button
          type="button"
          disabled={!clickable || onClose == null}
          onClick={() => onClose?.()}
          className="flex w-fit items-center gap-1 rounded border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium transition hover:border-[var(--color-danger)]/40 disabled:opacity-40"
        >
          <Icon as={X} size={12} />
          Fechar (Esc)
        </button>
        <div className="text-xs text-[var(--color-text-dim)]">
          {sent
            ? 'Enviado…'
            : searchFocused
              ? 'Digite pra filtrar; toque num item boolean pra marcar/desmarcar.'
              : 'Toque num item boolean pra marcar/desmarcar. Enums não são editáveis aqui.'}
        </div>
      </div>
    </div>
  )
}
