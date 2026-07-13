import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ccSettingsApi, projectsApi } from '@/lib/ipc'
import type {
  ClaudeCliSettings,
  ClaudeCliSettingsPatch,
  ClaudeSettingsScopeInput,
  Repo,
} from '../../../shared/types/ipc'
import { StatuslineScriptEditor } from './StatuslineScriptEditor'
import { CenterMessage } from './ui'

// Editor validado das chaves de alto uso de ~/.claude/settings.json. Isto
// configura o CLI claude — NÃO são as preferências do app (Configurações).
// env é visualização de NOMES apenas: valores podem ser secrets e nunca chegam
// ao renderer.

const EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const THEME_OPTIONS = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
] as const

interface FormState {
  model: string
  effortLevel: string
  autoMemory: '' | 'on' | 'off'
  statusLineCommand: string
  language: string
  theme: string
}

function toForm(view: ClaudeCliSettings): FormState {
  return {
    model: view.model ?? '',
    effortLevel: view.effortLevel ?? '',
    autoMemory: view.autoMemoryEnabled === null ? '' : view.autoMemoryEnabled ? 'on' : 'off',
    statusLineCommand: view.statusLineCommand ?? '',
    language: view.language ?? '',
    theme: view.theme ?? '',
  }
}

// Diff form → patch: só as chaves que MUDARAM entram (evita reescrever valores
// atuais que não passariam na validação, ex. enums antigos). '' = remover.
function buildPatch(initial: FormState, current: FormState): ClaudeCliSettingsPatch {
  const patch: ClaudeCliSettingsPatch = {}
  if (current.model !== initial.model) patch.model = current.model.trim() || null
  if (current.effortLevel !== initial.effortLevel) {
    patch.effortLevel = current.effortLevel || null
  }
  if (current.autoMemory !== initial.autoMemory) {
    patch.autoMemoryEnabled = current.autoMemory === '' ? null : current.autoMemory === 'on'
  }
  if (current.statusLineCommand !== initial.statusLineCommand) {
    patch.statusLineCommand = current.statusLineCommand.trim() || null
  }
  if (current.language !== initial.language) patch.language = current.language.trim() || null
  if (current.theme !== initial.theme) patch.theme = current.theme || null
  return patch
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--color-border)] py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="text-sm text-[var(--color-text)]">{label}</div>
        {hint && <div className="text-xs text-[var(--color-text-dim)]">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

const selectClass =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]'
const inputClass =
  'w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]'

export function CliSettingsTab() {
  const [initial, setInitial] = useState<FormState | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [envKeys, setEnvKeys] = useState<string[]>([])
  const [fileExists, setFileExists] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // Escopo: user (~/.claude/settings.json) ou projeto (.claude/settings.json
  // de um repo cadastrado — o main resolve o path pelo repoId).
  const [scope, setScope] = useState<ClaudeSettingsScopeInput['scope']>('user')
  const [repoId, setRepoId] = useState('')
  const [repos, setRepos] = useState<Repo[]>([])
  const [editingScript, setEditingScript] = useState(false)

  const scopeReady = scope === 'user' || repoId !== ''

  async function load(target: ClaudeSettingsScopeInput) {
    const view = await ccSettingsApi.read(target)
    const f = toForm(view)
    setInitial(f)
    setForm(f)
    setEnvKeys(view.envKeys)
    setFileExists(view.exists)
  }

  useEffect(() => {
    void projectsApi.listAllRepos().then(setRepos)
  }, [])

  useEffect(() => {
    setInitial(null)
    setForm(null)
    setMessage(null)
    if (scope === 'user') void load({ scope: 'user' })
    else if (repoId !== '') void load({ scope: 'project', repoId })
  }, [scope, repoId])

  const dirty = form && initial ? JSON.stringify(form) !== JSON.stringify(initial) : false

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setMessage(null)
  }

  async function save() {
    if (!form || !initial || !scopeReady) return
    setSaving(true)
    try {
      const result = await ccSettingsApi.write({
        scope,
        ...(scope === 'project' ? { repoId } : {}),
        patch: buildPatch(initial, form),
      })
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) await load(scope === 'user' ? { scope } : { scope, repoId })
    } finally {
      setSaving(false)
    }
  }

  const scopeSelector = (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <span className="text-xs text-[var(--color-text-dim)]">Escopo</span>
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value as ClaudeSettingsScopeInput['scope'])}
        className={selectClass}
      >
        <option value="user">user (~/.claude/settings.json)</option>
        <option value="project">projeto (.claude/settings.json)</option>
      </select>
      {scope === 'project' && (
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)} className={selectClass}>
          <option value="">— escolha o repo —</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      )}
      {scopeReady && !fileExists && form && (
        <span className="text-xs text-[var(--color-text-dim)]">
          arquivo ainda não existe — será criado ao salvar
        </span>
      )}
    </div>
  )

  if (!scopeReady) {
    return (
      <div className="h-full overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {scopeSelector}
          <CenterMessage text="Escolha um repo pra editar o settings.json do projeto." />
        </div>
      </div>
    )
  }

  if (!form || !initial) return <CenterMessage text="Carregando…" />

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-4">
        {scopeSelector}

        <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-text)]">
          Isto edita{' '}
          <code className="font-mono">
            {scope === 'user' ? '~/.claude/settings.json' : '.claude/settings.json do repo'}
          </code>{' '}
          — a configuração do <strong>CLI claude</strong>
          {scope === 'user' ? ', usada por todas as sessões' : ', usada nas sessões desse repo'}.
          Não confundir com as preferências do app (Configurações). Um backup{' '}
          <code className="font-mono">.bak</code> é criado na primeira escrita.
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Field label="Modelo" hint="Alias (opus, sonnet…) ou ID completo. Vazio = remover a chave.">
            <input
              type="text"
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="ex.: opus"
              className={inputClass}
            />
          </Field>

          <Field label="Esforço (effortLevel)" hint="Nível de raciocínio padrão do CLI.">
            <select
              value={form.effortLevel}
              onChange={(e) => set('effortLevel', e.target.value)}
              className={selectClass}
            >
              <option value="">— não definido —</option>
              {EFFORT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Memória automática (autoMemoryEnabled)">
            <select
              value={form.autoMemory}
              onChange={(e) => set('autoMemory', e.target.value as FormState['autoMemory'])}
              className={selectClass}
            >
              <option value="">— não definido —</option>
              <option value="on">Ligada</option>
              <option value="off">Desligada</option>
            </select>
          </Field>

          <Field
            label="Status line (comando)"
            hint="Campo command do statusLine; os demais campos são preservados."
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={form.statusLineCommand}
                onChange={(e) => set('statusLineCommand', e.target.value)}
                placeholder="ex.: ~/.claude/statusline.sh"
                className={inputClass}
              />
              {/* O main resolve o path pelo command SALVO no settings.json do
                  user — por isso o editor só aparece no escopo user. */}
              {scope === 'user' && (
                <button
                  type="button"
                  onClick={() => setEditingScript((v) => !v)}
                  className="shrink-0 text-xs text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
                >
                  {editingScript ? 'Fechar script' : 'Editar script'}
                </button>
              )}
            </div>
          </Field>

          {editingScript && scope === 'user' && (
            <div className="border-t border-[var(--color-border)] py-3">
              <StatuslineScriptEditor onClose={() => setEditingScript(false)} />
            </div>
          )}

          <Field label="Idioma (language)" hint="Ex.: Portuguese, English.">
            <input
              type="text"
              value={form.language}
              onChange={(e) => set('language', e.target.value)}
              placeholder="ex.: Portuguese"
              className={inputClass}
            />
          </Field>

          <Field label="Tema (theme)">
            <select
              value={form.theme}
              onChange={(e) => set('theme', e.target.value)}
              className={selectClass}
            >
              <option value="">— não definido —</option>
              {THEME_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-1 text-sm text-[var(--color-text)]">Variáveis de ambiente (env)</div>
          <div className="mb-2 text-xs text-[var(--color-text-dim)]">
            Somente os nomes são exibidos — os valores podem conter secrets e nunca saem do
            arquivo. Edite direto no settings.json se precisar.
          </div>
          {envKeys.length === 0 ? (
            <div className="text-xs text-[var(--color-text-dim)]">Nenhuma variável definida.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {envKeys.map((k) => (
                <code
                  key={k}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-dim)]"
                >
                  {k}
                </code>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          {message && (
            <span
              className={`text-xs ${message.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
            >
              {message.text}
            </span>
          )}
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Salvando…' : 'Salvar no settings.json'}
          </Button>
        </div>
      </div>
    </div>
  )
}
