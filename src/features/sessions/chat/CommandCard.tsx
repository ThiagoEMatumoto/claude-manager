import { useState } from 'react'
import { ChevronRight, TerminalSquare } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { CopyButton } from '@/components/ui/CopyButton'

// Slash command do usuário (/goal, /model, …). Alinhado à direita como as bolhas
// de user — é uma AÇÃO do humano — mas com cara de comando: fonte mono + accent.
export function CommandCard({ name, args }: { name: string; args: string }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] items-center gap-1.5 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1.5 text-xs text-[var(--color-text)]">
        <Icon as={TerminalSquare} size={12} className="shrink-0 text-[var(--color-accent)]" />
        <span className="break-all font-mono">
          /{name}
          {args ? ` ${args}` : ''}
        </span>
      </div>
    </div>
  )
}

// Resumo de uma linha da saída quando o card está fechado.
function summarize(text: string, max = 140): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

// Saída de um slash command (<local-command-stdout>, ANSI já removido no parser).
// Colapsado por default no padrão do ToolResultCard — a saída costuma ser longa.
export function CommandOutputCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <Icon as={ChevronRight} size={12} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        <Icon as={TerminalSquare} size={12} className="shrink-0 text-[var(--color-text-dim)]" />
        <span className="shrink-0 font-medium text-[var(--color-text-dim)]">saída do comando</span>
        {!open && <span className="truncate text-[var(--color-text-dim)]">{summarize(text)}</span>}
      </button>
      {open && (
        <div className="group relative border-t border-[var(--color-border)]">
          <CopyButton
            text={text}
            className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100"
            size={11}
          />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-[var(--color-text-dim)]">
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}
