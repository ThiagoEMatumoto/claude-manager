import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ccSettingsApi } from '@/lib/ipc'
import { CenterMessage } from './ui'

// Editor de ~/.claude/keybindings.json (atalhos do CLI claude). Valida o parse
// do JSON no cliente antes de salvar (o main revalida); arquivo inexistente
// mostra vazio com dica e é criado ao salvar.

function parseError(content: string): string | null {
  if (content.trim() === '') return 'vazio — escreva um objeto JSON'
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'a raiz deve ser um objeto'
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export function KeybindingsTab() {
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState('')
  const [exists, setExists] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void ccSettingsApi.readKeybindings().then((file) => {
      setContent(file.content)
      setSavedContent(file.content)
      setExists(file.exists)
    })
  }, [])

  if (content === null) return <CenterMessage text="Carregando…" />

  const dirty = content !== savedContent
  const jsonError = dirty ? parseError(content) : null

  async function save() {
    if (content === null || parseError(content)) return
    setSaving(true)
    try {
      const result = await ccSettingsApi.writeKeybindings(content)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) {
        setSavedContent(content)
        setExists(true)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4">
      <div className="text-xs text-[var(--color-text-dim)]">
        Atalhos do <strong>CLI claude</strong> (~/.claude/keybindings.json). O JSON precisa
        parsear antes de salvar; backup .bak criado na primeira escrita.
      </div>
      {!exists && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-dim)]">
          O arquivo ainda não existe — escreva um objeto JSON (ex.:{' '}
          <code className="font-mono">{'{ "keybindings": [] }'}</code>) e salve pra criá-lo.
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setMessage(null)
        }}
        spellCheck={false}
        placeholder='{ "keybindings": [] }'
        className="min-h-0 w-full flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="flex items-center justify-end gap-3">
        {message && (
          <span
            className={`text-xs ${message.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
          >
            {message.text}
          </span>
        )}
        {jsonError && (
          <span className="text-xs text-[var(--color-danger)]">JSON inválido: {jsonError}</span>
        )}
        {dirty && !jsonError && !message && (
          <span className="text-xs text-[var(--color-text-dim)]">alterações não salvas</span>
        )}
        <Button onClick={() => void save()} disabled={!dirty || jsonError !== null || saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
