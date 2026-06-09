import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Select, Textarea } from '@/features/objectives/ObjectiveDialog'
import { objectivesApi } from '@/lib/ipc'
import type {
  CreateTaskInput,
  Feature,
  ObjectiveWithProgress,
  Task,
  TaskLink,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from '../../../shared/types/ipc'
import { PARENT_TYPE_META, PRIORITY_META, PRIORITY_ORDER, TASK_STATUS_META, TASK_STATUS_ORDER } from './status'

// <input type="date"> trabalha com 'YYYY-MM-DD' local; persistimos epoch ms.
// (Mesmos helpers privados do ObjectiveDialog — module-private lá de propósito.)
function tsToDateInput(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function dateInputToTs(s: string): number | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

interface Props {
  open: boolean
  onClose: () => void
  // Presente = edição; ausente = criação (standalone se sem vínculo).
  task?: Task | null
  objectives: ObjectiveWithProgress[]
  features: Feature[]
  resolveLinkLabel: (link: TaskLink) => string
  onCreate: (input: CreateTaskInput) => Promise<void>
  // Edição: campos + conjunto final de vínculos (a área decide se chama setLinks).
  onUpdate: (input: UpdateTaskInput, links: TaskLink[]) => Promise<void>
}

interface KrOption {
  id: string
  title: string
}

export function TaskDialog({
  open,
  onClose,
  task,
  objectives,
  features,
  resolveLinkLabel,
  onCreate,
  onUpdate,
}: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<'' | TaskPriority>('')
  const [dueDate, setDueDate] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [notes, setNotes] = useState('')
  const [links, setLinks] = useState<TaskLink[]>([])
  // Seleção de KR é em dois passos: escolher o objetivo carrega os KRs dele.
  const [krObjectiveId, setKrObjectiveId] = useState('')
  const [krOptions, setKrOptions] = useState<KrOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setStatus(task?.status ?? 'todo')
    setPriority(task?.priority ?? '')
    setDueDate(tsToDateInput(task?.dueDate ?? null))
    setTagsText(task?.tags.join(', ') ?? '')
    setNotes(task?.notes ?? '')
    setLinks(task?.links ?? [])
    setKrObjectiveId('')
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, task])

  useEffect(() => {
    if (!krObjectiveId) {
      setKrOptions([])
      return
    }
    let alive = true
    void objectivesApi.get(krObjectiveId).then((detail) => {
      if (alive) setKrOptions(detail?.keyResults.map((kr) => ({ id: kr.id, title: kr.title })) ?? [])
    })
    return () => {
      alive = false
    }
  }, [krObjectiveId])

  function addLink(link: TaskLink) {
    setLinks((prev) =>
      prev.some((l) => l.parentType === link.parentType && l.parentId === link.parentId)
        ? prev
        : [...prev, link],
    )
  }

  function removeLink(link: TaskLink) {
    setLinks((prev) =>
      prev.filter((l) => !(l.parentType === link.parentType && l.parentId === link.parentId)),
    )
  }

  async function handleSubmit() {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority: priority || null,
        dueDate: dateInputToTs(dueDate),
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: notes.trim() || null,
      }
      if (task) {
        await onUpdate({ id: task.id, ...fields }, links)
      } else {
        await onCreate({ ...fields, links })
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? 'Editar tarefa' : 'Nova tarefa'}
      widthClassName="w-[34rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()} loading={submitting}>
            {task ? 'Salvar' : 'Criar'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input
          ref={titleRef}
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: revisar contrato do fornecedor"
        />
        <Textarea
          label="Descrição"
          value={description}
          onChange={setDescription}
          placeholder="Detalhes da tarefa…"
        />

        <div className="grid grid-cols-3 gap-3">
          <Select label="Status" value={status} onChange={(v) => setStatus(v as TaskStatus)}>
            {TASK_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <Select
            label="Prioridade"
            value={priority}
            onChange={(v) => setPriority(v as '' | TaskPriority)}
          >
            <option value="">—</option>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </Select>
          <Input
            label="Prazo"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <Input
          label="Tags (separadas por vírgula)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Ex: trabalho, urgente"
        />

        <Textarea label="Notas" value={notes} onChange={setNotes} placeholder="Anotações livres…" />

        {/* ---- Vínculos (pai: objetivo / KR / feature) ---- */}
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3">
          <div className="text-xs font-medium text-[var(--color-text)]">Vínculos</div>

          {links.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              Sem vínculo — tarefa standalone.
            </div>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {links.map((link) => (
                <li
                  key={`${link.parentType}:${link.parentId}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text)]"
                >
                  <span className="shrink-0 font-medium text-[var(--color-accent)]">
                    {PARENT_TYPE_META[link.parentType].label}
                  </span>
                  <span className="truncate">{resolveLinkLabel(link)}</span>
                  <button
                    type="button"
                    title="Remover vínculo"
                    onClick={() => removeLink(link)}
                    className="shrink-0 rounded text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
                  >
                    <Icon as={X} size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Select
            label="Adicionar vínculo a objetivo"
            value=""
            onChange={(v) => {
              if (v) addLink({ parentType: 'objective', parentId: v })
            }}
          >
            <option value="">—</option>
            {objectives.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Objetivo do key result"
              value={krObjectiveId}
              onChange={setKrObjectiveId}
            >
              <option value="">—</option>
              {objectives.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
            <Select
              label="Adicionar vínculo a KR"
              value=""
              onChange={(v) => {
                if (v) addLink({ parentType: 'key_result', parentId: v })
              }}
            >
              <option value="">
                {krObjectiveId
                  ? krOptions.length > 0
                    ? '—'
                    : 'Objetivo sem KRs'
                  : 'Escolha o objetivo'}
              </option>
              {krOptions.map((kr) => (
                <option key={kr.id} value={kr.id}>
                  {kr.title}
                </option>
              ))}
            </Select>
          </div>

          <Select
            label="Adicionar vínculo a feature"
            value=""
            onChange={(v) => {
              if (v) addLink({ parentType: 'feature', parentId: v })
            }}
          >
            <option value="">—</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Dialog>
  )
}
