import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { projectsApi, scheduledJobsApi } from '@/lib/ipc'
import { useJobsStore } from '@/store/jobsStore'
import { MODEL_OPTIONS, EFFORT_OPTIONS, ADVISOR_OPTIONS } from '@/features/sessions/spawn-options'
import { PERMISSION_OPTIONS } from '@/features/sessions/permission-modes'
import { WORK_MODE_PRESETS } from '@/features/sessions/work-mode-presets'
import type {
  AdvisorModel,
  EffortLevel,
  PermissionMode,
  Repo,
  ScheduledJob,
} from '../../../shared/types/ipc'
import { formatSchedule } from './schedule-format'
import {
  buildCreateInput,
  buildSchedule,
  DEFAULT_SCHEDULE_FORM,
  scheduleToForm,
  type ScheduleFormState,
  type ScheduleType,
} from './job-form'

interface Props {
  open: boolean
  onClose: () => void
  // Presente = modo editar; ausente/null = modo criar.
  job?: ScheduledJob | null
}

const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
  { value: 'interval', label: 'Intervalo' },
  { value: 'daily', label: 'Diário' },
  { value: 'weekly', label: 'Semanal' },
]

// 0=domingo (mesma convenção de JobSchedule/computeNextRunAt).
const WEEKDAY_OPTIONS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
]

// MVP observe-only: jobs rodam sem supervisão, então só expomos os modos que não
// editam/executam (plan = read-only, default = pergunta tudo). Os autônomos ficam
// gated (bloqueados na UI e no MCP) até existirem os guards de segurança.
const OBSERVE_ONLY_MODES: PermissionMode[] = ['default', 'plan']
const PERMISSION_CHOICES = PERMISSION_OPTIONS.filter((o) => OBSERVE_ONLY_MODES.includes(o.value))

const segBtn = (active: boolean) =>
  `px-3 py-1.5 text-xs transition ${
    active
      ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
      : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
  }`

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function JobDialog({ open, onClose, job }: Props) {
  const create = useJobsStore((s) => s.create)
  const update = useJobsStore((s) => s.update)

  const [name, setName] = useState('')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>('')
  const [effort, setEffort] = useState<'' | EffortLevel>('')
  // Observe-only por default: um job roda sem supervisão, então o padrão seguro
  // é 'plan' (read-only, produz crítica/relatório sem tocar em nada).
  const [permission, setPermission] = useState<PermissionMode>('plan')
  const [advisorModel, setAdvisorModel] = useState<'' | AdvisorModel>('')
  const [selectedPreset, setSelectedPreset] = useState<string>('default')
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(DEFAULT_SCHEDULE_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [repos, setRepos] = useState<Repo[]>([])
  const [preview, setPreview] = useState<number[]>([])

  const schedule = useMemo(() => buildSchedule(scheduleForm), [scheduleForm])

  // (Re)inicializa o form ao abrir — modo editar hidrata do job; criar zera.
  useEffect(() => {
    if (!open) return
    if (job) {
      setName(job.name)
      setRepoId(job.repoId)
      setPrompt(job.prompt)
      setModel(job.model ?? '')
      setEffort(job.effort ?? '')
      setPermission(job.permissionMode)
      setAdvisorModel(job.advisorModel ?? '')
      setScheduleForm(scheduleToForm(job.schedule))
    } else {
      setName('')
      setRepoId(null)
      setPrompt('')
      setModel('')
      setEffort('')
      setPermission('plan')
      setAdvisorModel('')
      setScheduleForm(DEFAULT_SCHEDULE_FORM)
    }
    setSelectedPreset('default')
    setSubmitting(false)
    setError(null)
  }, [open, job])

  // Lista repos de todos os projetos pro picker (mesmo padrão da JobsArea).
  useEffect(() => {
    if (!open) return
    let alive = true
    void projectsApi.list().then(async (projects) => {
      const lists = await Promise.all(projects.map((p) => projectsApi.listRepos(p.id)))
      if (alive) setRepos(lists.flat())
    })
    return () => {
      alive = false
    }
  }, [open])

  // Preview das próximas 3 execuções, com debounce simples — reroda só quando o
  // schedule montado muda (não a cada tecla em name/prompt).
  useEffect(() => {
    if (!open) return
    let alive = true
    const t = setTimeout(() => {
      void scheduledJobsApi
        .previewRuns(schedule, 3)
        .then((ts) => {
          if (alive) setPreview(ts)
        })
        .catch(() => {
          if (alive) setPreview([])
        })
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [open, schedule])

  // Aplica os overrides do preset — 'default' reverte pros defaults seguros do
  // job (observe-only), os demais só mexem nos campos que declaram.
  function applyPreset(id: string) {
    setSelectedPreset(id)
    const preset = WORK_MODE_PRESETS.find((p) => p.id === id)
    if (!preset) return
    if (id === 'default') {
      setModel('')
      setEffort('')
      setPermission('plan')
      setAdvisorModel('')
      return
    }
    if (preset.model !== undefined) setModel(preset.model)
    if (preset.effort !== undefined) setEffort(preset.effort)
    if (preset.permission !== undefined) setPermission(preset.permission)
    if (preset.advisorModel !== undefined) setAdvisorModel(preset.advisorModel)
  }

  function pickPermission(v: PermissionMode) {
    setPermission(v)
  }

  function patchSchedule(patch: Partial<ScheduleFormState>) {
    setScheduleForm((prev) => ({ ...prev, ...patch }))
  }

  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0

  async function confirm() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const values = {
        name,
        repoId,
        prompt,
        schedule,
        model,
        effort,
        permissionMode: permission,
        advisorModel,
      }
      const input = buildCreateInput(values)
      if (job) {
        await update({ id: job.id, ...input })
      } else {
        await create(input)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  const submitLabel = job ? 'Salvar' : 'Criar'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={job ? `Editar job · ${job.name}` : 'Novo job'}
      widthClassName="w-[34rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!canSubmit} loading={submitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Modo de trabalho</label>
          <div className="flex flex-wrap gap-1.5">
            {WORK_MODE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  selectedPreset === preset.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Nome do job"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Revisão noturna do diff"
        />

        <div className="w-full">
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Repositório</label>
          <select
            value={repoId ?? ''}
            onChange={(e) => setRepoId(e.target.value || null)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">— Avulso (sem repo) —</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full">
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">
            Prompt (a tarefa/crítica do job)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="O que o Claude deve fazer a cada execução…"
            rows={4}
            className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Agendamento</label>
          <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
            {SCHEDULE_TYPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => patchSchedule({ type: opt.value })}
                className={segBtn(scheduleForm.type === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-3">
            {scheduleForm.type === 'interval' && (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-dim)]">
                A cada (horas)
                <input
                  type="number"
                  min={1}
                  value={scheduleForm.hours}
                  onChange={(e) => patchSchedule({ hours: e.target.valueAsNumber })}
                  className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            )}

            {scheduleForm.type === 'weekly' && (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-dim)]">
                Dia
                <select
                  value={scheduleForm.dayOfWeek}
                  onChange={(e) => patchSchedule({ dayOfWeek: Number(e.target.value) })}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                >
                  {WEEKDAY_OPTIONS.map((label, i) => (
                    <option key={label} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(scheduleForm.type === 'daily' || scheduleForm.type === 'weekly') && (
              <>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-dim)]">
                  Hora
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={scheduleForm.hour}
                    onChange={(e) => patchSchedule({ hour: e.target.valueAsNumber })}
                    className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-dim)]">
                  Minuto
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={scheduleForm.minute}
                    onChange={(e) => patchSchedule({ minute: e.target.valueAsNumber })}
                    className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </>
            )}
          </div>

          <div className="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2">
            <div className="text-xs font-medium text-[var(--color-text)]">
              {formatSchedule(schedule)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-dim)]">
              {preview.length > 0
                ? `Próximas: ${preview.map(formatWhen).join(' · ')}`
                : 'Sem execuções previstas.'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Modelo</label>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setModel(opt.value)}
                  className={segBtn(model === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Esforço</label>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
              {EFFORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEffort(opt.value)}
                  className={segBtn(effort === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Advisor</label>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
              {ADVISOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAdvisorModel(opt.value)}
                  className={segBtn(advisorModel === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Permissão</label>
          <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-[var(--color-border)]">
            {PERMISSION_CHOICES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => pickPermission(opt.value)}
                className={`shrink-0 ${segBtn(permission === opt.value)}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--color-text-dim)]">
            Modos autônomos indisponíveis nesta versão — jobs rodam observe-only.
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  )
}
