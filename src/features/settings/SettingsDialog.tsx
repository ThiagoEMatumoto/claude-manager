import { useEffect, useState } from 'react'
import { Settings, Palette, Keyboard, Bell } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { ColorSelect } from '@/components/ui/ColorSelect'
import { dialogApi, vaultApi } from '@/lib/ipc'
import { SHORTCUTS, type ShortcutContext } from '@/lib/shortcuts'
import { applyThemePref, loadThemePref, saveThemePref } from '@/app/useTheme'
import { DEFAULT_PRESET_ID, PRESETS, getPreset, type ThemePref } from '@/lib/themes'

interface Props {
  open: boolean
  onClose: () => void
}

type TabId = 'general' | 'appearance' | 'shortcuts' | 'notifications'

const TABS: { id: TabId; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'Geral', icon: Settings },
  { id: 'appearance', label: 'Aparência', icon: Palette },
  { id: 'shortcuts', label: 'Atalhos', icon: Keyboard },
  { id: 'notifications', label: 'Notificações', icon: Bell },
]

export function SettingsDialog({ open, onClose }: Props) {
  const [tab, setTab] = useState<TabId>('general')

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Configurações"
      widthClassName="w-[44rem]"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="flex min-h-[20rem] gap-5">
        <nav className="w-40 shrink-0 space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                tab === id
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-dim)] hover:bg-[var(--color-bg)]/40 hover:text-[var(--color-text)]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === 'general' && <GeneralTab open={open} />}
          {tab === 'appearance' && <AppearanceTab open={open} />}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'notifications' && <Placeholder />}
        </div>
      </div>
    </Dialog>
  )
}

function GeneralTab({ open }: { open: boolean }) {
  const [root, setRoot] = useState('')

  useEffect(() => {
    if (!open) return
    void vaultApi.getRoot().then(setRoot)
  }, [open])

  async function changeRoot() {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    await vaultApi.ensureDir(picked)
    await vaultApi.setRoot(picked)
    setRoot(picked)
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-dim)]">Pasta-raiz dos projetos</span>
        <button
          type="button"
          onClick={changeRoot}
          className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
        >
          Trocar
        </button>
      </div>
      <div className="truncate text-sm text-[var(--color-text)]" title={root || undefined}>
        {root || <span className="text-[var(--color-text-dim)]">carregando…</span>}
      </div>
    </div>
  )
}

const SWATCH_KEYS = ['bg', 'surface-2', 'accent', 'text', 'border'] as const

function AppearanceTab({ open }: { open: boolean }) {
  const [pref, setPref] = useState<ThemePref>({ presetId: DEFAULT_PRESET_ID })

  useEffect(() => {
    if (!open) return
    void loadThemePref().then((p) => {
      if (p) setPref(p)
    })
  }, [open])

  function update(next: ThemePref) {
    setPref(next)
    applyThemePref(next)
    void saveThemePref(next)
  }

  const accent = pref.accent ?? getPreset(pref.presetId).tokens.accent

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
          Tema
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => {
            const selected = preset.id === pref.presetId
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => update({ presetId: preset.id, accent: pref.accent })}
                className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                  selected
                    ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-text-dim)]'
                }`}
                style={{ background: preset.tokens.surface }}
              >
                <div className="flex gap-1">
                  {SWATCH_KEYS.map((k) => (
                    <span
                      key={k}
                      className="h-5 w-5 rounded-full"
                      style={{ background: preset.tokens[k] }}
                    />
                  ))}
                </div>
                <span className="text-sm" style={{ color: preset.tokens.text }}>
                  {preset.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
          Cor de destaque
        </div>
        <ColorSelect
          value={accent}
          onChange={(hex) => update({ presetId: pref.presetId, accent: hex })}
        />
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => update({ presetId: DEFAULT_PRESET_ID })}>
          Restaurar padrão
        </Button>
      </div>
    </div>
  )
}

function ShortcutsTab() {
  const contexts: ShortcutContext[] = ['Global', 'Workspace', 'Terminal']

  return (
    <div className="space-y-4">
      {contexts.map((ctx) => {
        const items = SHORTCUTS.filter((s) => s.context === ctx)
        if (items.length === 0) return null
        return (
          <div key={ctx}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
              {ctx}
            </div>
            <div className="space-y-1">
              {items.map((s) => (
                <div
                  key={s.combo + s.label}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-[var(--color-bg)]/40"
                >
                  <span className="text-[var(--color-text)]">{s.label}</span>
                  <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-dim)]">
                    {s.combo}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Placeholder() {
  return (
    <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-[var(--color-text-dim)]">
      Em breve
    </div>
  )
}
