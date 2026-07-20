import { useEffect, useState } from 'react'
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import { prefsApi } from '@/lib/ipc'
import { KNOWN_ENV_VARS } from '@shared/known-env-vars'

// Aba "Variáveis de ambiente": editor key=value das vars customizadas do usuário
// (pref `custom_env_vars`), injetadas nos spawns de processos externos (sidecar
// de transcrição, claude -p). Valores mascarados por padrão (podem ser secrets).

const CUSTOM_ENV_VARS_KEY = 'custom_env_vars'

interface Row {
  key: string
  value: string
}

function toRows(map: Record<string, string>): Row[] {
  return Object.entries(map).map(([key, value]) => ({ key, value }))
}

// Linhas → mapa para persistir. Ignora chaves vazias; última chave duplicada vence.
function toMap(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key, value } of rows) {
    const k = key.trim()
    if (k) out[k] = value
  }
  return out
}

const KNOWN_KEYS = new Set(KNOWN_ENV_VARS.map((v) => v.envKey))

export function EnvVarsTab({ open }: { open: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [revealedKnown, setRevealedKnown] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setRevealed(new Set())
    setRevealedKnown(new Set())
    void prefsApi.get<Record<string, string>>(CUSTOM_ENV_VARS_KEY).then((map) => {
      setRows(toRows(map ?? {}))
    })
  }, [open])

  function persist(next: Row[]) {
    setRows(next)
    void prefsApi.set(CUSTOM_ENV_VARS_KEY, toMap(next))
  }

  function updateRow(index: number, patch: Partial<Row>) {
    persist(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { key: '', value: '' }])
  }

  function removeRow(index: number) {
    setRevealed((prev) => {
      const next = new Set<number>()
      for (const i of prev) {
        if (i < index) next.add(i)
        else if (i > index) next.add(i - 1)
      }
      return next
    })
    persist(rows.filter((_, i) => i !== index))
  }

  // A integração escreve no MESMO mapa da lista livre: atualiza a linha da chave
  // se ela já existe, senão anexa uma nova.
  function setKnownValue(envKey: string, value: string) {
    const index = rows.findIndex((r) => r.key.trim() === envKey)
    if (index === -1) persist([...rows, { key: envKey, value }])
    else persist(rows.map((r, i) => (i === index ? { ...r, value } : r)))
  }

  function toggleRevealKnown(envKey: string) {
    setRevealedKnown((prev) => {
      const next = new Set(prev)
      if (next.has(envKey)) next.delete(envKey)
      else next.add(envKey)
      return next
    })
  }

  function toggleReveal(index: number) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // As chaves de integração são editadas na seção própria — fora da lista livre,
  // pra não aparecerem duas vezes. O índice original é preservado (revealed/remove).
  const customRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !KNOWN_KEYS.has(row.key.trim()))

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
          Integrações
        </div>
        <p className="mb-3 text-xs text-[var(--color-text-dim)]">
          Credenciais que o app sabe usar. Sem elas, a funcionalidade correspondente fica
          desligada.
        </p>

        <div className="space-y-3">
          {KNOWN_ENV_VARS.map((integration) => {
            const value = rows.find((r) => r.key.trim() === integration.envKey)?.value ?? ''
            const isRevealed = revealedKnown.has(integration.envKey)
            const configured = value.trim().length > 0
            return (
              <div key={integration.envKey} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--color-text)]">
                    {integration.label}
                  </span>
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[10px]"
                    style={{
                      color: configured
                        ? 'var(--color-success, #22c55e)'
                        : 'var(--color-text-dim)',
                      borderColor: configured
                        ? 'var(--color-success, #22c55e)'
                        : 'var(--color-border)',
                    }}
                  >
                    {configured ? 'configurada' : 'não configurada'}
                  </span>
                  <span className="truncate text-[11px] text-[var(--color-text-dim)]">
                    {integration.unlocks}
                  </span>
                  <a
                    href={integration.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto shrink-0 text-[11px] text-[var(--color-accent)] hover:underline"
                  >
                    Obter chave
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate font-mono text-xs text-[var(--color-text-dim)]">
                    {integration.envKey}
                  </span>
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => setKnownValue(integration.envKey, e.target.value)}
                    placeholder="valor"
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => toggleRevealKnown(integration.envKey)}
                    title={isRevealed ? 'Ocultar valor' : 'Mostrar valor'}
                    className="shrink-0 rounded p-1 text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
                  >
                    {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
          Variáveis de ambiente
        </div>
        <p className="mb-3 text-xs text-[var(--color-text-dim)]">
          Injetadas nos processos abertos pelo app (sidecar de transcrição, extração via
          claude). Têm precedência sobre as variáveis herdadas do sistema. Valores podem
          conter segredos — ficam mascarados até você revelar.
        </p>

        {customRows.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--color-text-dim)]">
            Nenhuma variável definida.
          </div>
        ) : (
          <div className="space-y-2">
            {customRows.map(({ row, index }) => {
              const isRevealed = revealed.has(index)
              return (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => updateRow(index, { key: e.target.value })}
                    placeholder="NOME"
                    spellCheck={false}
                    autoComplete="off"
                    className="w-40 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <span className="text-[var(--color-text-dim)]">=</span>
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    value={row.value}
                    onChange={(e) => updateRow(index, { value: e.target.value })}
                    placeholder="valor"
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => toggleReveal(index)}
                    title={isRevealed ? 'Ocultar valor' : 'Mostrar valor'}
                    className="shrink-0 rounded p-1 text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
                  >
                    {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    title="Remover"
                    className="shrink-0 rounded p-1 text-[var(--color-text-dim)] transition hover:text-[var(--color-danger,#ef4444)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addRow}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar variável
        </button>
      </div>
    </div>
  )
}
