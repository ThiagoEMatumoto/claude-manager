import { useEffect, useState } from 'react'
import { Settings, Palette, Keyboard, Bell, Info } from 'lucide-react'
import { AboutTab } from './AboutTab'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { ColorSelect } from '@/components/ui/ColorSelect'
import { dialogApi, prefsApi, vaultApi } from '@/lib/ipc'
import type { NotificationPrefs } from '../../../shared/types/ipc'
import {
  COMMANDS,
  formatCombo,
  resolveCombo,
  type Combo,
  type Command,
  type ShortcutContext,
} from '@/lib/keybindings'
import { useKeybindingsStore } from '@/lib/keybindings-store'
import { useTerminalPrefsStore } from '@/lib/terminal-prefs-store'
import { applyThemePref, loadThemePref, saveThemePref } from '@/app/useTheme'
import { DEFAULT_PRESET_ID, PRESETS, getPreset, type ThemePref } from '@/lib/themes'

interface Props {
  open: boolean
  onClose: () => void
}

type TabId = 'general' | 'appearance' | 'shortcuts' | 'notifications' | 'about'

const TABS: { id: TabId; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'Geral', icon: Settings },
  { id: 'appearance', label: 'Aparência', icon: Palette },
  { id: 'shortcuts', label: 'Atalhos', icon: Keyboard },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'about', label: 'Sobre', icon: Info },
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
          {tab === 'notifications' && <NotificationsTab open={open} />}
          {tab === 'about' && <AboutTab open={open} />}
        </div>
      </div>
    </Dialog>
  )
}

const SCRATCH_DIR_DEFAULT = '~/ClaudeManager/scratch'

function GeneralTab({ open }: { open: boolean }) {
  const [root, setRoot] = useState('')
  const [scratchDir, setScratchDir] = useState('')
  const scrollback = useTerminalPrefsStore((s) => s.scrollback)
  const setScrollback = useTerminalPrefsStore((s) => s.setScrollback)
  const visualLineNav = useTerminalPrefsStore((s) => s.visualLineNav)
  const setVisualLineNav = useTerminalPrefsStore((s) => s.setVisualLineNav)

  useEffect(() => {
    if (!open) return
    void vaultApi.getRoot().then(setRoot)
    void prefsApi.get<string>('scratch_dir').then((dir) => setScratchDir(dir ?? ''))
    void useTerminalPrefsStore.getState().load()
  }, [open])

  async function changeRoot() {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    await vaultApi.ensureDir(picked)
    await vaultApi.setRoot(picked)
    setRoot(picked)
  }

  async function changeScratchDir() {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    await prefsApi.set('scratch_dir', picked)
    setScratchDir(picked)
  }

  return (
    <div className="space-y-4">
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

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-dim)]">Pasta das sessões avulsas</span>
          <button
            type="button"
            onClick={changeScratchDir}
            className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
          >
            Trocar
          </button>
        </div>
        <div
          className="truncate text-sm text-[var(--color-text)]"
          title={scratchDir || SCRATCH_DIR_DEFAULT}
        >
          {scratchDir || (
            <span className="text-[var(--color-text-dim)]">{SCRATCH_DIR_DEFAULT}</span>
          )}
        </div>
      </div>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
          Terminal
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-[var(--color-text)]">Linhas de histórico (scrollback)</div>
            <div className="text-xs text-[var(--color-text-dim)]">
              Quantas linhas o terminal mantém roláveis (200–50000).
            </div>
          </div>
          <input
            type="number"
            min={200}
            max={50000}
            step={500}
            value={scrollback}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) void setScrollback(n)
            }}
            className="w-24 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1 text-right text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <label className="mt-3 flex items-start justify-between gap-3 border-t border-[var(--color-border)] pt-3">
          <div className="min-w-0">
            <div className="text-sm text-[var(--color-text)]">Navegação por linha visual (↑/↓ no prompt)</div>
            <div className="text-xs text-[var(--color-text-dim)]">
              ↑/↓ movem o cursor pelas linhas do prompt em vez de ir pro histórico. Pode
              interferir no histórico e em menus de seleção do claude. Para compor prompts
              longos sem isso, use o editor de prompt (Ctrl+Shift+E).
            </div>
          </div>
          <input
            type="checkbox"
            checked={visualLineNav}
            onChange={(e) => void setVisualLineNav(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
          />
        </label>
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

// Igualdade de Combo pra detecção de conflito (mesma chave canônica que o matcher usa).
function comboKey(c: Combo): string {
  const k = c.code ? `code:${c.code}` : c.key ? `key:${c.key.toLowerCase()}` : ''
  return `${c.mod ? 1 : 0}${c.shift ? 1 : 0}${c.alt ? 1 : 0}|${k}`
}

// Constrói um Combo a partir de um keydown (mesma lógica de prioridade do matcher:
// Backslash vira code; o resto vira key). Retorna null para press só-de-modificador.
function comboFromEvent(e: KeyboardEvent): Combo | null {
  const key = e.key
  if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') return null
  const combo: Combo = {}
  if (e.ctrlKey || e.metaKey) combo.mod = true
  if (e.shiftKey) combo.shift = true
  if (e.altKey) combo.alt = true
  if (e.code === 'Backslash') combo.code = 'Backslash'
  else combo.key = key
  return combo
}

function ShortcutsTab() {
  const contexts: ShortcutContext[] = ['Global', 'Workspace', 'Terminal']
  const overrides = useKeybindingsStore((s) => s.overrides)
  const setOverride = useKeybindingsStore((s) => s.setOverride)
  const reset = useKeybindingsStore((s) => s.reset)

  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ id: string; message: string } | null>(null)

  // Em modo captura, escuta o próximo keydown e grava o override (ou avisa conflito).
  useEffect(() => {
    if (!capturingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // só modificador: continua capturando
      const newKey = comboKey(combo)
      const clashing = COMMANDS.find(
        (c) =>
          c.editable &&
          c.id !== capturingId &&
          comboKey(resolveCombo(c.id, overrides)) === newKey,
      )
      if (clashing) {
        setConflict({ id: capturingId, message: `Conflito com "${clashing.label}"` })
        setCapturingId(null)
        return
      }
      void setOverride(capturingId, combo)
      setConflict(null)
      setCapturingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingId, overrides, setOverride])

  function renderRow(cmd: Command) {
    const combo = resolveCombo(cmd.id, overrides)
    const hasOverride = cmd.id in overrides
    const capturing = capturingId === cmd.id
    return (
      <div
        key={cmd.id}
        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--color-bg)]/40"
      >
        <span className="min-w-0 flex-1 text-[var(--color-text)]">
          {cmd.label}
          {!cmd.editable && (
            <span className="ml-2 text-xs text-[var(--color-text-dim)]">(fixo)</span>
          )}
          {conflict?.id === cmd.id && (
            <span className="ml-2 text-xs text-[var(--color-danger,#ef4444)]">
              {conflict.message}
            </span>
          )}
        </span>
        <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-dim)]">
          {capturing ? 'Pressione…' : formatCombo(combo)}
        </kbd>
        {cmd.editable && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setConflict(null)
                setCapturingId(capturing ? null : cmd.id)
              }}
            >
              {capturing ? 'Cancelar' : 'Editar'}
            </Button>
            {hasOverride && (
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setConflict(null)
                  void reset(cmd.id)
                }}
              >
                Restaurar
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {contexts.map((ctx) => {
        const items = COMMANDS.filter((c) => c.context === ctx)
        if (items.length === 0) return null
        return (
          <div key={ctx}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
              {ctx}
            </div>
            <div className="space-y-1">{items.map(renderRow)}</div>
          </div>
        )
      })}
    </div>
  )
}

const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
  enabled: true,
  sessionWaiting: true,
  usageHigh: true,
}

function NotificationsTab({ open }: { open: boolean }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS)

  useEffect(() => {
    if (!open) return
    void prefsApi.get<NotificationPrefs>('notifications').then((p) => {
      if (p) setPrefs({ ...DEFAULT_NOTIF_PREFS, ...p })
    })
  }, [open])

  function update(next: NotificationPrefs) {
    setPrefs(next)
    void prefsApi.set('notifications', next)
  }

  return (
    <div className="space-y-4">
      <Toggle
        label="Ativar notificações"
        checked={prefs.enabled}
        onChange={(v) => update({ ...prefs, enabled: v })}
      />
      <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <Toggle
          label="Sessão aguardando você"
          checked={prefs.sessionWaiting}
          disabled={!prefs.enabled}
          onChange={(v) => update({ ...prefs, sessionWaiting: v })}
        />
        <Toggle
          label="Uso alto (janela 5h/semanal)"
          checked={prefs.usageHigh}
          disabled={!prefs.enabled}
          onChange={(v) => update({ ...prefs, usageHigh: v })}
        />
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between rounded-md px-1 py-1 text-sm transition-opacity ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      }`}
    >
      <span className="text-[var(--color-text)]">{label}</span>
      <span
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ background: checked ? 'var(--color-accent)' : 'var(--color-border)' }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
        />
      </span>
    </button>
  )
}
