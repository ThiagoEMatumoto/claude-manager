import { useEffect, useState } from 'react'
import { AlertTriangle, Archive, PlayCircle, RefreshCw } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { dossiersApi } from '@/lib/ipc'
import { useDossiersStore } from '@/store/dossiersStore'
import type { Dossier, DossierRun } from '../../../shared/types/ipc'
import { NewDossierForm } from './NewDossierForm'
import { RunDetailView } from './RunDetailView'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from './dossier-labels'

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function RunStatusBadge({ status }: { status: DossierRun['status'] }) {
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

function DossierListItem({ dossier, active }: { dossier: Dossier; active: boolean }) {
  const selectDossier = useDossiersStore((s) => s.selectDossier)
  const archive = useDossiersStore((s) => s.archive)
  return (
    <div
      className="flex items-start justify-between gap-2 rounded-md border p-2 transition"
      style={{
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        background: active ? 'var(--color-accent)0d' : 'var(--color-surface)',
      }}
    >
      <button
        type="button"
        onClick={() => void selectDossier(dossier.id)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-sm font-medium text-[var(--color-text)]">{dossier.title}</div>
        <div className="truncate text-xs text-[var(--color-text-dim)]">{dossier.question}</div>
      </button>
      <button
        type="button"
        onClick={() => void archive(dossier.id)}
        title="Arquivar dossiê"
        className="shrink-0 rounded p-1 text-[var(--color-text-dim)] transition hover:text-[var(--color-danger)]"
      >
        <Icon as={Archive} size={14} />
      </button>
    </div>
  )
}

// Coluna de detalhe: runs do dossiê selecionado + botão "Iniciar pesquisa" + o
// detalhe da run selecionada (despachado por status no RunDetailView).
function DetailColumn() {
  const selectedDossierId = useDossiersStore((s) => s.selectedDossierId)
  const dossiers = useDossiersStore((s) => s.dossiers)
  const runs = useDossiersStore((s) => s.runs)
  const selectedRunId = useDossiersStore((s) => s.selectedRunId)
  const runDetail = useDossiersStore((s) => s.runDetail)
  const busy = useDossiersStore((s) => s.busy)
  const startRun = useDossiersStore((s) => s.startRun)
  const selectRun = useDossiersStore((s) => s.selectRun)

  const dossier = dossiers.find((d) => d.id === selectedDossierId)

  if (!dossier) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-dim)]">
        Selecione um dossiê para ver suas pesquisas.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{dossier.title}</h2>
        <p className="text-sm text-[var(--color-text-dim)]">{dossier.question}</p>
      </div>

      <button
        type="button"
        onClick={() => void startRun(dossier.id)}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md border border-[var(--color-accent)] px-3 py-2 text-sm font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10 disabled:opacity-50"
      >
        <Icon as={PlayCircle} size={16} />
        {busy ? 'Iniciando…' : 'Iniciar pesquisa'}
      </button>

      {runs.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase text-[var(--color-text-dim)]">
            Pesquisas
          </div>
          <div className="flex flex-col gap-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => void selectRun(run.id)}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-left transition"
                style={{
                  borderColor:
                    run.id === selectedRunId ? 'var(--color-accent)' : 'var(--color-border)',
                  background:
                    run.id === selectedRunId ? 'var(--color-accent)0d' : 'var(--color-surface)',
                }}
              >
                <RunStatusBadge status={run.status} />
                <span className="text-[11px] text-[var(--color-text-dim)]">
                  {formatDate(run.startedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {runDetail && <RunDetailView detail={runDetail} />}
    </div>
  )
}

// Sem a chave da Tavily o funil roda com fontes fabricadas pelo provedor stub e
// o dossiê "conclui" mesmo assim — o aviso existe pra essa falha não ser silenciosa.
function WebSearchWarning() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    void dossiersApi.isWebSearchEnabled().then(setEnabled)
  }, [])

  if (enabled !== false) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-warning)]/10 px-5 py-2 text-xs text-[var(--color-warning)]">
      <Icon as={AlertTriangle} size={14} />
      <span>
        Busca web desligada — configure TAVILY_API_KEY em Configurações › Variáveis de ambiente.
      </span>
    </div>
  )
}

export function DossiersPanel() {
  const dossiers = useDossiersStore((s) => s.dossiers)
  const loading = useDossiersStore((s) => s.loading)
  const selectedDossierId = useDossiersStore((s) => s.selectedDossierId)
  const load = useDossiersStore((s) => s.load)
  const startWatch = useDossiersStore((s) => s.startWatch)
  const stopWatch = useDossiersStore((s) => s.stopWatch)

  useEffect(() => {
    void load()
    startWatch()
    return () => stopWatch()
  }, [load, startWatch, stopWatch])

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-[var(--color-text)]">Dossiês</h1>
          <p className="text-xs text-[var(--color-text-dim)]">
            Pesquisa profunda com proveniência rastreável.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          title="Recarregar"
          className="rounded-md p-1.5 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Icon as={RefreshCw} size={16} />
        </button>
      </div>

      <WebSearchWarning />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-[var(--color-border)] p-3">
          <NewDossierForm />
          {dossiers.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--color-text-dim)]">
              {loading ? 'Carregando…' : 'Nenhum dossiê ainda.'}
            </div>
          ) : (
            dossiers.map((d) => (
              <DossierListItem key={d.id} dossier={d} active={d.id === selectedDossierId} />
            ))
          )}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <DetailColumn />
        </div>
      </div>
    </main>
  )
}
