import { useState } from 'react'
import { AlertTriangle, ChevronRight, CornerDownRight, Wrench } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

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
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <Icon as={ChevronRight} size={12} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        <Icon as={Wrench} size={12} className="shrink-0 text-[var(--color-accent)]" />
        <span className="shrink-0 font-medium text-[var(--color-text)]">{name}</span>
        {!open && <span className="truncate text-[var(--color-text-dim)]">{summarize(input)}</span>}
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] px-2 py-1.5 text-[var(--color-text-dim)]">
          {pretty(input)}
        </pre>
      )}
    </div>
  )
}

export function ToolResultCard({ content, isError }: { content: string; isError: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`rounded-md border bg-[var(--color-surface)]/40 text-xs ${
        isError ? 'border-[var(--color-danger)]/50' : 'border-[var(--color-border)]'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <Icon as={ChevronRight} size={12} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        <Icon
          as={isError ? AlertTriangle : CornerDownRight}
          size={12}
          className={`shrink-0 ${isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-dim)]'}`}
        />
        <span
          className={`shrink-0 font-medium ${
            isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-dim)]'
          }`}
        >
          {isError ? 'erro' : 'resultado'}
        </span>
        {!open && <span className="truncate text-[var(--color-text-dim)]">{summarize(content)}</span>}
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] px-2 py-1.5 text-[var(--color-text-dim)]">
          {content}
        </pre>
      )}
    </div>
  )
}
