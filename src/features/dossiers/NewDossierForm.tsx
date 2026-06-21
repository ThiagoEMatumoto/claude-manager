import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useDossiersStore } from '@/store/dossiersStore'
import type { SourceClass } from '../../../shared/types/ipc'
import { SOURCE_CLASS_LABEL } from './dossier-labels'

const ALL_CLASSES: SourceClass[] = [
  'primary_official',
  'academic',
  'reputable_press',
  'practitioner_video',
  'forum_ugc',
  'vendor_marketing',
  'blog_seo',
]

// Form de criação de dossiê: título, pergunta, multi-select de classes de fonte e
// budget opcional. Ao criar, seleciona o dossiê novo automaticamente.
export function NewDossierForm() {
  const create = useDossiersStore((s) => s.create)
  const selectDossier = useDossiersStore((s) => s.selectDossier)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [classes, setClasses] = useState<Set<SourceClass>>(new Set(['primary_official']))
  const [budget, setBudget] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function toggleClass(c: SourceClass) {
    setClasses((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  function reset() {
    setTitle('')
    setQuestion('')
    setClasses(new Set(['primary_official']))
    setBudget('')
  }

  async function submit() {
    if (submitting || title.trim().length === 0 || question.trim().length === 0 || classes.size === 0)
      return
    setSubmitting(true)
    try {
      const parsedBudget = budget.trim() ? Number(budget.trim()) : null
      const dossier = await create({
        title: title.trim(),
        question: question.trim(),
        sourceClasses: [...classes],
        budgetTokens: parsedBudget && Number.isFinite(parsedBudget) ? parsedBudget : null,
      })
      if (dossier) {
        reset()
        setOpen(false)
        await selectDossier(dossier.id)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-dim)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
      >
        <Icon as={Plus} size={16} />
        Novo dossiê
      </button>
    )
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título do dossiê"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Pergunta de pesquisa…"
        rows={2}
        className="resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase text-[var(--color-text-dim)]">
          Classes de fonte
        </div>
        <div className="flex flex-wrap gap-1">
          {ALL_CLASSES.map((c) => {
            const active = classes.has(c)
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleClass(c)}
                className="rounded-full border px-2 py-0.5 text-[11px] transition"
                style={{
                  color: active ? 'var(--color-accent)' : 'var(--color-text-dim)',
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                  background: active ? 'var(--color-accent)1a' : undefined,
                }}
              >
                {SOURCE_CLASS_LABEL[c]}
              </button>
            )
          })}
        </div>
      </div>
      <input
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        placeholder="Budget de tokens (opcional)"
        inputMode="numeric"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            reset()
          }}
          className="rounded px-2 py-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={
            submitting ||
            title.trim().length === 0 ||
            question.trim().length === 0 ||
            classes.size === 0
          }
          className="rounded border border-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10 disabled:opacity-40"
        >
          {submitting ? 'Criando…' : 'Criar'}
        </button>
      </div>
    </form>
  )
}
