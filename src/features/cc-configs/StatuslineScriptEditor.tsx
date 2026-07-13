import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ccSettingsApi } from '@/lib/ipc'
import type { StatuslineScriptFile } from '../../../shared/types/ipc'

// Editor inline do script apontado por statusLine.command (settings.json do
// user). O main resolve o path e só permite alvos dentro do HOME — fora disso
// mostra o aviso retornado.

export function StatuslineScriptEditor({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<StatuslineScriptFile | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void ccSettingsApi.readStatuslineScript().then((f) => {
      setFile(f)
      if (f.ok) {
        setContent(f.content ?? '')
        setSavedContent(f.content ?? '')
      }
    })
  }, [])

  if (file === null) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs text-[var(--color-text-dim)]">
        Carregando script…
      </div>
    )
  }

  if (!file.ok) {
    return (
      <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4">
        <div className="text-xs text-[var(--color-text)]">{file.message}</div>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    )
  }

  const dirty = content !== savedContent

  async function save() {
    setSaving(true)
    try {
      const result = await ccSettingsApi.writeStatuslineScript(content)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) setSavedContent(content)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate font-mono text-[11px] text-[var(--color-text-dim)]" title={file.path}>
          {file.path}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
        >
          Fechar
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setMessage(null)
        }}
        spellCheck={false}
        rows={14}
        className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="mt-2 flex items-center justify-end gap-3">
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
          {saving ? 'Salvando…' : 'Salvar script'}
        </Button>
      </div>
    </div>
  )
}
