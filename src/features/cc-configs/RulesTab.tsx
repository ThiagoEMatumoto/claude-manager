import { useEffect, useState } from 'react'
import { ccSettingsApi } from '@/lib/ipc'
import type { RuleFileEntry } from '../../../shared/types/ipc'
import { CenterMessage } from './ui'

// Visualização read-only de ~/.claude/rules (arquivos .md carregados pelo CLI
// claude em toda sessão). Edição fica fora de escopo — regras costumam ser
// geridas por tooling externo (plugins, sync de time).
export function RulesTab() {
  const [rules, setRules] = useState<RuleFileEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)

  useEffect(() => {
    void ccSettingsApi.listRules().then((list) => {
      setRules(list)
      if (list.length > 0) setSelected(list[0].relPath)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    // Guarda contra resposta stale: trocando rápido de rule, a promise antiga
    // pode resolver depois da nova e sobrescrever o conteúdo da seleção atual.
    let cancelled = false
    setLoadingContent(true)
    void ccSettingsApi
      .readRule(selected)
      .then((file) => {
        if (!cancelled) setContent(file.exists ? file.content : 'Arquivo não encontrado.')
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  if (rules === null) return <CenterMessage text="Carregando…" />
  if (rules.length === 0) return <CenterMessage text="Nenhuma rule em ~/.claude/rules." />

  return (
    <div className="flex h-full min-h-0">
      <div className="w-72 shrink-0 overflow-y-auto border-r border-[var(--color-border)] py-2">
        {rules.map((rule) => {
          const isActive = rule.relPath === selected
          return (
            <button
              key={rule.relPath}
              type="button"
              onClick={() => setSelected(rule.relPath)}
              title={rule.relPath}
              className={`block w-full truncate px-4 py-1.5 text-left text-xs transition ${
                isActive
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
              }`}
            >
              {rule.relPath}
            </button>
          )
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
          read-only · ~/.claude/rules/{selected}
        </div>
        {loadingContent ? (
          <div className="text-xs text-[var(--color-text-dim)]">Carregando…</div>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--color-text)]">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}
