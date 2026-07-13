import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ccSettingsApi } from '@/lib/ipc'
import { CenterMessage } from './ui'

// Editor de ~/.claude/CLAUDE.md (instruções globais do CLI claude). Escrita
// atômica no main + backup .bak na primeira gravação.
export function ClaudeMdTab() {
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void ccSettingsApi.readClaudeMd().then((file) => {
      setContent(file.content)
      setSavedContent(file.content)
    })
  }, [])

  if (content === null) return <CenterMessage text="Carregando…" />

  const dirty = content !== savedContent

  async function save() {
    if (content === null) return
    setSaving(true)
    try {
      const result = await ccSettingsApi.writeClaudeMd(content)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) setSavedContent(content)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4">
      <div className="text-xs text-[var(--color-text-dim)]">
        Instruções globais do <strong>CLI claude</strong> (~/.claude/CLAUDE.md) — valem para
        todas as sessões, de todos os projetos. Backup .bak criado na primeira escrita.
      </div>
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setMessage(null)
        }}
        spellCheck={false}
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
        {dirty && !message && (
          <span className="text-xs text-[var(--color-text-dim)]">alterações não salvas</span>
        )}
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
