import { useState } from 'react'
import { AlertTriangle, ChevronRight, CornerDownRight, Terminal, Wrench } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Icon } from '@/components/ui/Icon'
import { CopyButton } from '@/components/ui/CopyButton'

// Ícone da tool: terminal pras de shell (Bash), wrench pro resto. O transcript
// (ChatMessage.tool_use) não expõe elapsed/duração, então não há "✓ Xs" a mostrar.
function toolIcon(name: string): ComponentType<LucideProps> {
  return /^(bash|shell|sh|zsh)$/i.test(name.trim()) ? Terminal : Wrench
}

// Resumo de uma linha do input/result quando o card está fechado.
function summarize(value: unknown, max = 140): string {
  let s: string
  if (value == null) s = ''
  else if (typeof value === 'string') s = value
  else {
    try {
      s = JSON.stringify(value)
    } catch {
      s = String(value)
    }
  }
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function ToolUseCard({ name, input }: { name: string; input: unknown }) {
  const [open, setOpen] = useState(false)
  // Linha de telemetria: mono, wrench accent, path/args em dim com ellipsis.
  return (
    <div className="rounded-lg font-mono text-[11px] transition-colors hover:bg-[var(--color-surface-2)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-1.5 py-1 text-left"
      >
        <Icon as={ChevronRight} size={11} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        <Icon as={toolIcon(name)} size={11} className="shrink-0 text-[var(--color-accent)]" />
        <span className="shrink-0 text-[var(--color-text)]">{name}</span>
        <span className="truncate text-[var(--color-text-dim)]">{summarize(input)}</span>
      </button>
      {open && (
        <div className="group relative border-t border-[var(--color-border)]">
          <CopyButton
            text={pretty(input)}
            className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100"
            size={11}
          />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[var(--color-text-dim)]">
            {pretty(input)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ToolResultCard({ content, isError }: { content: string; isError: boolean }) {
  const [open, setOpen] = useState(false)
  // Resultado como linha de telemetria: ✓ em accent2 (sucesso) / ✕ em coral (erro).
  return (
    <div
      className={`rounded-lg font-mono text-[11px] transition-colors hover:bg-[var(--color-surface-2)] ${
        isError ? 'bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-1.5 py-1 text-left"
      >
        <Icon as={ChevronRight} size={11} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        <Icon
          as={isError ? AlertTriangle : CornerDownRight}
          size={11}
          className={`shrink-0 ${isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-accent2)]'}`}
        />
        <span
          className={`shrink-0 ${
            isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-accent2)]'
          }`}
        >
          {isError ? '✕ erro' : '✓ resultado'}
        </span>
        {!open && <span className="truncate text-[var(--color-text-dim)]">{summarize(content)}</span>}
      </button>
      {open && (
        <div className="group relative border-t border-[var(--color-border)]">
          <CopyButton
            text={content}
            className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100"
            size={11}
          />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[var(--color-text-dim)]">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}
