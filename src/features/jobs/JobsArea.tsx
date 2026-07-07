import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Pause, Play, Plus } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'
import { projectsApi } from '@/lib/ipc'
import { useJobsStore } from '@/store/jobsStore'
import type { JobRun, JobRunStatus, Repo, ScheduledJob } from '../../../shared/types/ipc'
import { formatSchedule } from './schedule-format'

// JobRunStatus não é assignável a HandoffStatus (scheduled/success/missed são
// exclusivos daqui), então não reusamos o StatusBadge de handoffs — mapa local
// análogo. interrupted/missed usam o tom de aviso (recuperável, não erro real).
const RUN_STATUS_COLOR: Record<JobRunStatus, string> = {
  scheduled: 'var(--color-text-dim)',
  running: 'var(--color-info)',
  success: 'var(--color-success)',
  failed: 'var(--color-danger)',
  interrupted: 'var(--color-warning)',
  missed: 'var(--color-warning)',
}

const RUN_STATUS_LABEL: Record<JobRunStatus, string> = {
  scheduled: 'Agendado',
  running: 'Rodando',
  success: 'Sucesso',
  failed: 'Falhou',
  interrupted: 'Interrompido',
  missed: 'Perdido',
}

function RunStatusBadge({ status }: { status: JobRunStatus }) {
  const color = RUN_STATUS_COLOR[status]
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color, borderColor: color, background: `${color}1a` }}
    >
      {RUN_STATUS_LABEL[status]}
    </span>
  )
}

function formatWhen(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(started: number | null, finished: number | null): string | null {
  if (!started || !finished) return null
  const secs = Math.max(0, Math.round((finished - started) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}min ${secs % 60}s`
}

// captureQuality degradada → aviso legível. full/null não geram aviso.
function captureWarning(quality: JobRun['captureQuality']): string | null {
  if (quality === 'none') return 'sem relatório capturado'
  if (quality === 'partial') return 'relatório parcial'
  return null
}

export function JobsArea() {
  const jobs = useJobsStore((s) => s.jobs)
  const selectedJobId = useJobsStore((s) => s.selectedJobId)
  const runs = useJobsStore((s) => s.runs)
  const loading = useJobsStore((s) => s.loading)
  const runsLoading = useJobsStore((s) => s.runsLoading)
  const selectJob = useJobsStore((s) => s.selectJob)
  const runNow = useJobsStore((s) => s.runNow)
  const toggleEnabled = useJobsStore((s) => s.toggleEnabled)
  const load = useJobsStore((s) => s.load)
  const startWatch = useJobsStore((s) => s.startWatch)
  const stopWatch = useJobsStore((s) => s.stopWatch)

  const [reposById, setReposById] = useState<Map<string, Repo>>(new Map())
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void load()
    startWatch()
    return () => stopWatch()
  }, [load, startWatch, stopWatch])

  // Resolve labels de repo (mesmo padrão da FeaturesArea: projetos → repos).
  useEffect(() => {
    let alive = true
    void projectsApi.list().then(async (projects) => {
      const lists = await Promise.all(projects.map((p) => projectsApi.listRepos(p.id)))
      if (alive) setReposById(new Map(lists.flat().map((r) => [r.id, r])))
    })
    return () => {
      alive = false
    }
  }, [])

  // Troca de job zera a run aberta no detalhe.
  useEffect(() => {
    setSelectedRunId(null)
  }, [selectedJobId])

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  )
  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  )

  function repoLabel(job: ScheduledJob): string {
    if (!job.repoId) return 'Avulso'
    return reposById.get(job.repoId)?.label ?? 'Repo'
  }

  async function handleRunNow(id: string) {
    setRunning(true)
    try {
      await runNow(id)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--color-text)]">Jobs agendados</span>
          {/* Criação de job chega na Fase 3b — placeholder desabilitado por ora. */}
          <button
            type="button"
            disabled
            title="Novo job (em breve)"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-dim)] opacity-50"
          >
            <Icon as={Plus} size={14} />
            Novo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && jobs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-text-dim)]">Carregando…</p>
          ) : jobs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-text-dim)]">Nenhum job ainda.</p>
          ) : (
            <ul>
              {jobs.map((job) => {
                const active = job.id === selectedJobId
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => void selectJob(job.id)}
                      className={`flex w-full flex-col gap-1 border-b border-[var(--color-border)] px-4 py-3 text-left transition ${
                        active
                          ? 'bg-[var(--color-surface-2)]'
                          : 'hover:bg-[var(--color-surface-2)]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[var(--color-text)]">
                          {job.name}
                        </span>
                        {!job.enabled && (
                          <span className="shrink-0 text-[11px] text-[var(--color-text-dim)]">
                            pausado
                          </span>
                        )}
                      </div>
                      <span className="truncate text-xs text-[var(--color-text-dim)]">
                        {repoLabel(job)} · {formatSchedule(job.schedule)}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-dim)]">
                        {job.enabled ? `Próximo: ${formatWhen(job.nextRunAt)}` : 'Sem agendamento'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {!selectedJob ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-dim)]">
            <div className="flex flex-col items-center gap-2">
              <Icon as={CalendarClock} size={32} />
              <span>Selecione um job.</span>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-[var(--color-text)]">
                  {selectedJob.name}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-text-dim)]">
                  {repoLabel(selectedJob)} · {formatSchedule(selectedJob.schedule)} ·{' '}
                  {selectedJob.enabled
                    ? `próximo ${formatWhen(selectedJob.nextRunAt)}`
                    : 'pausado'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRunNow(selectedJob.id)}
                  disabled={running}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg)] transition hover:opacity-90 disabled:opacity-50"
                >
                  <Icon as={Play} size={14} />
                  {running ? 'Iniciando…' : 'Run now'}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleEnabled(selectedJob.id, !selectedJob.enabled)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)]"
                >
                  <Icon as={selectedJob.enabled ? Pause : Play} size={14} />
                  {selectedJob.enabled ? 'Pausar' : 'Ativar'}
                </button>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
              <section className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)]">
                <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-dim)]">
                  Histórico
                </h3>
                {runsLoading && runs.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-[var(--color-text-dim)]">Carregando…</p>
                ) : runs.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-[var(--color-text-dim)]">
                    Nenhuma execução ainda.
                  </p>
                ) : (
                  <ul>
                    {runs.map((run) => {
                      const active = run.id === selectedRunId
                      return (
                        <li key={run.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedRunId(run.id)}
                            className={`flex w-full flex-col gap-1 border-b border-[var(--color-border)] px-4 py-3 text-left transition ${
                              active
                                ? 'bg-[var(--color-surface-2)]'
                                : 'hover:bg-[var(--color-surface-2)]/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <RunStatusBadge status={run.status} />
                              <span className="text-[11px] text-[var(--color-text-dim)]">
                                {formatWhen(run.startedAt ?? run.createdAt)}
                              </span>
                            </div>
                            {captureWarning(run.captureQuality) && (
                              <span className="text-[11px] text-[var(--color-warning)]">
                                {captureWarning(run.captureQuality)}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="flex-1 overflow-y-auto p-6">
                {!selectedRun ? (
                  <p className="text-sm text-[var(--color-text-dim)]">
                    Selecione uma execução para ver o relatório.
                  </p>
                ) : (
                  <RunDetail run={selectedRun} />
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </>
  )
}

function RunDetail({ run }: { run: JobRun }) {
  const duration = formatDuration(run.startedAt, run.finishedAt)
  const warning = captureWarning(run.captureQuality)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-dim)]">
        <RunStatusBadge status={run.status} />
        <span>Início: {formatWhen(run.startedAt)}</span>
        <span>Fim: {formatWhen(run.finishedAt)}</span>
        {duration && <span>Duração: {duration}</span>}
        {run.model && <span>Modelo: {run.model}</span>}
        {run.tokens != null && <span>Tokens: {run.tokens.toLocaleString('pt-BR')}</span>}
      </div>

      {run.error && (
        <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          {run.error}
        </div>
      )}

      {run.status === 'running' ? (
        <p className="text-sm text-[var(--color-text-dim)]">Execução em andamento…</p>
      ) : run.reportText ? (
        <div>
          {warning && (
            <p className="mb-2 text-xs text-[var(--color-warning)]">{warning}</p>
          )}
          <MarkdownViewer content={run.reportText} />
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-dim)]">
          {warning ?? 'Sem relatório para esta execução.'}
        </p>
      )}
    </div>
  )
}
