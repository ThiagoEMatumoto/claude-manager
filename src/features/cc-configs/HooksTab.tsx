import { useEffect, useState } from 'react'
import { ccSettingsApi } from '@/lib/ipc'
import type { HookInfo, HookToggleEntry } from '../../../shared/types/ipc'
import { EntityCard, FocusableCard, isFocused } from './CcConfigsView'
import type { FocusedItem } from './navigation'
import { Badge, Card, CenterMessage } from './ui'

// Aba Hooks com toggle POR entry do ~/.claude/settings.json. Desligar remove a
// entry do arquivo e guarda o original em app_prefs (religável); hooks de
// plugins e o inventário de scripts (~/.claude/hooks) seguem view-only.

interface Props {
  hooks: HookInfo[]
  loading: boolean
  focus: FocusedItem | null
  onClearFocus: () => void
  // Notifica a Area pra atualizar contagens/inventário após um toggle.
  onChanged: () => void
}

function ToggleEntryCard({
  entry,
  onToggled,
}: {
  entry: HookToggleEntry
  onToggled: (result: { ok: boolean; message: string }) => void
}) {
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    try {
      const result = entry.disabled
        ? await ccSettingsApi.enableHook(entry.event, entry.index)
        : // entry.entry vai junto: o main casa por conteúdo, o índice é só dica.
          await ccSettingsApi.disableHook(entry.event, entry.index, entry.entry)
      onToggled(result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--color-text)]">
              {entry.event}
            </span>
            {entry.matcher && <Badge>{entry.matcher}</Badge>}
            {entry.disabled && <Badge tone="warn">desligado pelo app</Badge>}
          </div>
          <div
            className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-dim)]"
            title={entry.summary}
          >
            {entry.summary}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={`shrink-0 text-xs transition disabled:opacity-50 ${
            entry.disabled
              ? 'text-[var(--color-success)] hover:opacity-80'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-danger)]'
          }`}
        >
          {busy ? '…' : entry.disabled ? 'Religar' : 'Desligar'}
        </button>
      </div>
    </Card>
  )
}

export function HooksTab({ hooks, loading, focus, onClearFocus, onChanged }: Props) {
  const [entries, setEntries] = useState<HookToggleEntry[] | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    setEntries(await ccSettingsApi.listHooks())
  }

  useEffect(() => {
    void load()
  }, [])

  // Cards view-only: hooks de plugins + o resumo de scripts em ~/.claude/hooks
  // (pseudo-entry 'scripts' do inventário — não é entry do settings.json).
  const readOnly = hooks.filter((h) => h.origin !== 'user' || h.event === 'scripts')

  if (entries === null || (loading && readOnly.length === 0)) {
    return <CenterMessage text="Carregando…" />
  }

  async function handleToggled(result: { ok: boolean; message: string }) {
    setMessage({ ok: result.ok, text: result.message })
    if (result.ok) {
      await load()
      onChanged()
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--color-text-dim)]">
            Entries de <code className="font-mono">hooks</code> do ~/.claude/settings.json —
            desligar remove do arquivo (backup .bak) e guarda o original no app pra religar.
          </div>
          {message && (
            <span
              className={`shrink-0 text-xs ${message.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
            >
              {message.text}
            </span>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="py-4 text-center text-sm text-[var(--color-text-dim)]">
            Nenhum hook no settings.json.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {entries.map((e) => (
              <ToggleEntryCard
                key={`${e.disabled ? 'off' : 'on'}:${e.event}:${e.index}`}
                entry={e}
                onToggled={(r) => void handleToggled(r)}
              />
            ))}
          </div>
        )}

        {readOnly.length > 0 && (
          <>
            <div className="pt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
              Plugins e scripts (view-only)
            </div>
            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
              {readOnly.map((h, i) => (
                <FocusableCard
                  key={`${h.origin}:${h.event}:${i}`}
                  focused={isFocused(focus, 'hooks', h.event, h.origin)}
                  onClearFocus={onClearFocus}
                >
                  <EntityCard
                    name={h.event}
                    badge="hook"
                    origin={h.origin}
                    description={h.summary || undefined}
                  />
                </FocusableCard>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
