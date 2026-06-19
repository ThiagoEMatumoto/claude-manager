import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, TerminalSquare } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { handoffsApi, prefsApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'
import { useHandoffsStore } from '@/store/handoffsStore'
import type { Handoff, HandoffStatus } from '../../../shared/types/ipc'

const HEARTBEAT_TTL_KEY = 'handoffs.heartbeatTtlHours'
const HEARTBEAT_TTL_DEFAULT = 2

// Um handoff `running` está "sem heartbeat" se o último sinal de progresso é mais
// antigo que o TTL. Usa step_updated_at (último handoff_progress) e cai pra
// updated_at quando a filha nunca reportou passo. Puro → testável.
export function isStale(handoff: Handoff, ttlHours: number, now: number): boolean {
  if (handoff.status !== 'running') return false
  const last = handoff.stepUpdatedAt ?? handoff.updatedAt
  return now - last > ttlHours * 3_600_000
}

// "há Xh" arredondado pra baixo (mínimo 1h, já que só chamamos quando stale).
export function staleLabel(handoff: Handoff, now: number): string {
  const last = handoff.stepUpdatedAt ?? handoff.updatedAt
  const hours = Math.max(1, Math.floor((now - last) / 3_600_000))
  return `sem progresso há ${hours}h`
}

// Inbox de handoffs cross-repo: lista todos agrupados por status, com label do
// repo-alvo (resolvido no store via JOIN), tarefa, badge de status, data, e —
// quando done/failed — o resumo/erro expansível. A assinatura load+watch já é
// montada pelo useHandoffs() no AppShell; aqui só lemos do store.

const STATUS_LABEL: Record<HandoffStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  running: 'Em andamento',
  done: 'Concluído',
  rejected: 'Rejeitado',
  failed: 'Falhou',
}

// status → token de cor (texto + borda + fundo translúcido).
const STATUS_COLOR: Record<HandoffStatus, string> = {
  pending: 'var(--color-warning)',
  running: 'var(--color-info)',
  done: 'var(--color-success)',
  failed: 'var(--color-danger)',
  rejected: 'var(--color-text-dim)',
  approved: 'var(--color-accent)',
}

// Ordem de agrupamento/exibição: ativos primeiro, terminais depois.
const STATUS_ORDER: HandoffStatus[] = [
  'pending',
  'approved',
  'running',
  'done',
  'failed',
  'rejected',
]

function StatusBadge({ status }: { status: HandoffStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color, borderColor: color, background: `${color}1a` }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

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

function HandoffCard({ handoff, ttlHours }: { handoff: Handoff; ttlHours: number }) {
  const [expanded, setExpanded] = useState(false)
  const [failing, setFailing] = useState(false)
  const liveSessions = useAppStore((s) => s.liveSessions)
  const focusOrOpenSession = useAppStore((s) => s.focusOrOpenSession)
  const load = useHandoffsStore((s) => s.load)
  const repoLabel = handoff.targetRepoLabel ?? handoff.targetRepoId
  const hasDetail =
    (handoff.status === 'done' && !!handoff.summary) ||
    (handoff.status === 'failed' && !!handoff.error)

  // Sem heartbeat: só faz sentido pra running. Calculado no render — a lista
  // recarrega periodicamente via watch, mantendo o "há Xh" razoavelmente fresco.
  const stale = isStale(handoff, ttlHours, Date.now())

  // Recovery manual: força failed via IPC handoffs:fail. Disponível pra running e
  // pra approved travado (aprovado mas a filha nunca subiu). Confirmação evita
  // matar uma filha viva em trabalho longo por engano.
  const canForceFail = handoff.status === 'running' || handoff.status === 'approved'

  async function forceFail() {
    if (failing) return
    const ok = window.confirm(
      `Forçar falha deste handoff para "${repoLabel}"? A sessão-filha não será encerrada automaticamente; use isto quando ela travou ou já morreu.`,
    )
    if (!ok) return
    setFailing(true)
    try {
      await handoffsApi.fail({ id: handoff.id, error: 'Falha forçada manualmente pelo usuário' })
      await load()
    } catch {
      setFailing(false)
    }
  }

  // A filha já está rodando num PTY. "Abrir terminal" RE-ATTACHA uma pane à
  // sessão viva (focusOrOpenSession → paneFromLiveSession), nunca re-spawn/--resume.
  // Só dá pra attachar se a filha ainda aparece no liveSessions (PTY viva).
  const childLive =
    handoff.status === 'running' && handoff.childSessionId
      ? liveSessions.find((s) => s.id === handoff.childSessionId)
      : undefined

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--color-text)]">
              → {repoLabel}
            </span>
            <StatusBadge status={handoff.status} />
          </div>
          <div className="mt-1 text-sm text-[var(--color-text-dim)]">{handoff.task}</div>
          {handoff.status === 'running' && handoff.currentStep && (
            <div className="mt-1 truncate text-xs text-[var(--color-info)]" title={handoff.currentStep}>
              {handoff.currentStep}
            </div>
          )}
          {stale && (
            <div
              className="mt-1 flex items-center gap-1 text-xs text-[var(--color-warning)]"
              title="A sessão-filha não reporta progresso há um tempo — pode ter travado."
            >
              <Icon as={AlertTriangle} size={12} />
              {staleLabel(handoff, Date.now())}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-[var(--color-text-dim)]">
            {formatDate(handoff.createdAt)}
          </span>
          {childLive && (
            <button
              type="button"
              onClick={() => void focusOrOpenSession(childLive)}
              title="Anexar o terminal desta sessão-filha"
              className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <Icon as={TerminalSquare} size={12} />
              Abrir terminal
            </button>
          )}
          {canForceFail && (
            <button
              type="button"
              onClick={() => void forceFail()}
              disabled={failing}
              title="Marcar este handoff como falho (recovery manual)"
              className="flex items-center gap-1 rounded border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] text-[var(--color-danger)] transition hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
            >
              <Icon as={AlertTriangle} size={12} />
              {failing ? 'Falhando…' : 'Forçar falha'}
            </button>
          )}
        </div>
      </div>

      {hasDetail && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            {expanded
              ? 'Ocultar'
              : handoff.status === 'done'
                ? 'Ver resumo'
                : 'Ver erro'}
          </button>
          {expanded && (
            <pre
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-xs"
              style={{
                color:
                  handoff.status === 'failed'
                    ? 'var(--color-danger)'
                    : 'var(--color-text)',
              }}
            >
              {handoff.status === 'failed' ? handoff.error : handoff.summary}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function HandoffsPanel() {
  const handoffs = useHandoffsStore((s) => s.handoffs)
  const loading = useHandoffsStore((s) => s.loading)
  const load = useHandoffsStore((s) => s.load)
  const [ttlHours, setTtlHours] = useState(HEARTBEAT_TTL_DEFAULT)

  useEffect(() => {
    void prefsApi
      .get<number>(HEARTBEAT_TTL_KEY)
      .then((v) => setTtlHours(v ?? HEARTBEAT_TTL_DEFAULT))
  }, [])

  // Agrupa por status na ordem ativos → terminais; cada grupo já vem ordenado
  // por createdAt DESC do store.
  const groups = useMemo(() => {
    return STATUS_ORDER.map((status) => ({
      status,
      items: handoffs.filter((h) => h.status === status),
    })).filter((g) => g.items.length > 0)
  }, [handoffs])

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-[var(--color-text)]">Handoffs</h1>
          <p className="text-xs text-[var(--color-text-dim)]">
            Delegações cross-repo entre sessões.
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

      <div className="flex-1 overflow-y-auto p-5">
        {handoffs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-dim)]">
            {loading ? 'Carregando…' : 'Nenhum handoff ainda.'}
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {groups.map((group) => (
              <section key={group.status}>
                <div className="mb-2 flex items-center gap-2">
                  <StatusBadge status={group.status} />
                  <span className="text-xs text-[var(--color-text-dim)]">
                    {group.items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.items.map((h) => (
                    <HandoffCard key={h.id} handoff={h} ttlHours={ttlHours} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
