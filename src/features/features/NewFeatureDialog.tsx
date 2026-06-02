import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { projectsApi } from '@/lib/ipc'
import type { CreateFeatureInput, Project, Repo } from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  projects: Project[]
  defaultProjectId?: string | null
  onCreate: (input: CreateFeatureInput) => Promise<void>
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="w-full">
      <label className="mb-1 block text-xs text-[var(--color-text-dim)]">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
    </div>
  )
}

export function NewFeatureDialog({
  open,
  onClose,
  projects,
  defaultProjectId,
  onCreate,
}: Props) {
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [repos, setRepos] = useState<Repo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [objective, setObjective] = useState('')
  const [businessRules, setBusinessRules] = useState('')
  const [approach, setApproach] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setObjective('')
    setBusinessRules('')
    setApproach('')
    setSelectedRepos(new Set())
    setProjectId(defaultProjectId || projects[0]?.id || '')
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, defaultProjectId, projects])

  useEffect(() => {
    if (!projectId) {
      setRepos([])
      return
    }
    let alive = true
    void projectsApi.listRepos(projectId).then((list) => {
      if (alive) setRepos(list)
    })
    setSelectedRepos(new Set())
    return () => {
      alive = false
    }
  }, [projectId])

  function toggleRepo(id: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit() {
    if (!title.trim() || !projectId || submitting) return
    setSubmitting(true)
    try {
      await onCreate({
        projectId,
        title: title.trim(),
        objective: objective.trim() || null,
        repos: [...selectedRepos].map((repoId) => ({
          repoId,
          branch: null,
          worktreePath: null,
        })),
        overview: objective.trim() || undefined,
        businessRules: businessRules.trim() || undefined,
        approach: approach.trim() || undefined,
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nova feature"
      widthClassName="w-[34rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || !projectId} loading={submitting}>
            Criar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          ref={titleRef}
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: memória de features"
        />

        <div className="w-full">
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Projeto</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            {projects.length === 0 && <option value="">Nenhum projeto</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon ? `${p.icon} ` : ''}
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full">
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Repos</label>
          {repos.length === 0 ? (
            <p className="text-xs text-[var(--color-text-dim)]">Nenhum repo neste projeto.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {repos.map((r) => {
                const on = selectedRepos.has(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRepo(r.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                      on
                        ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <Textarea
          label="Objetivo"
          value={objective}
          onChange={setObjective}
          placeholder="O que esta feature deve alcançar?"
        />
        <Textarea
          label="Regras de negócio"
          value={businessRules}
          onChange={setBusinessRules}
          placeholder="Restrições, invariantes, requisitos…"
        />
        <Textarea
          label="Abordagem"
          value={approach}
          onChange={setApproach}
          placeholder="Estratégia técnica inicial…"
        />
      </div>
    </Dialog>
  )
}
