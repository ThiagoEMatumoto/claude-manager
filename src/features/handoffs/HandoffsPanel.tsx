import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CircleSlash,
  CornerDownLeft,
  Play,
  RefreshCw,
  Send,
  TerminalSquare,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { handoffsApi, prefsApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'
import { useHandoffsStore } from '@/store/handoffsStore'
import type { Handoff, HandoffOutcome, HandoffStatus, LiveSessionInfo } from '../../../shared/types/ipc'

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

// "há Xs / Xmin / Xh" pro último sinal de atividade da filha (reusa a escala do
// Terminal). Puro → testável. Null se nunca houve atividade.
export function liveActivityLabel(at: number | null, now: number): string | null {
  if (at == null) return null
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `há ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.round(m / 60)
  return `há ${h}h`
}

// Tokens de contexto compactos: "128k ctx" / "12k ctx" / "900 ctx". Null se ausente.
export function contextLabel(tokens: LiveSessionInfo['tokens']): string | null {
  const ctx = tokens?.context
  if (ctx == null) return null
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}k ctx`
  return `${ctx} ctx`
}

// Liveness derivada do status da sessão-filha viva (LiveSessionInfo). `undefined`
// = filha não está mais no liveSessions (PTY encerrou). Mapeia pra label + token
// de cor existente. Puro → testável.
export interface LiveBadge {
  label: string
  color: string
  // waiting/ended pedem destaque/ação no card.
  attention: boolean
}

export function liveBadgeFor(status: LiveSessionInfo['status'] | undefined): LiveBadge {
  switch (status) {
    case 'working':
      return { label: 'trabalhando', color: 'var(--color-info)', attention: false }
    case 'waiting':
      return { label: 'aguardando você', color: 'var(--color-warning)', attention: true }
    case 'starting':
      return { label: 'iniciando', color: 'var(--color-info)', attention: false }
    case 'idle':
      return { label: 'ociosa', color: 'var(--color-text-dim)', attention: false }
    case 'ended':
    case undefined:
    default:
      return { label: 'filha encerrou', color: 'var(--color-danger)', attention: true }
  }
}

// Inbox de handoffs cross-repo: lista todos agrupados por status, com label do
// repo-alvo (resolvido no store via JOIN), tarefa, badge de status, data, e —
// quando done/failed — o resumo/erro expansível. A assinatura load+watch já é
// montada pelo useHandoffs() no AppShell; aqui só lemos do store.

const STATUS_LABEL: Record<HandoffStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  running: 'Em andamento',
  needs_input: 'Aguardando resposta',
  done: 'Concluído',
  rejected: 'Rejeitado',
  failed: 'Falhou',
  interrupted: 'Interrompido',
}

// status → token de cor (texto + borda + fundo translúcido). interrupted usa o
// tom de aviso (recuperável, não é erro real como failed).
const STATUS_COLOR: Record<HandoffStatus, string> = {
  pending: 'var(--color-warning)',
  running: 'var(--color-info)',
  needs_input: 'var(--color-warning)',
  done: 'var(--color-success)',
  failed: 'var(--color-danger)',
  rejected: 'var(--color-text-dim)',
  approved: 'var(--color-accent)',
  interrupted: 'var(--color-warning)',
}

// Ordem de agrupamento/exibição: ativos primeiro, recuperáveis no meio, terminais
// depois. interrupted fica antes dos terminais (pede ação: retomar).
const STATUS_ORDER: HandoffStatus[] = [
  'pending',
  'approved',
  'running',
  'needs_input',
  'interrupted',
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
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [rating, setRating] = useState(false)
  const [resumable, setResumable] = useState(false)
  const [resuming, setResuming] = useState(false)
  const liveSessions = useAppStore((s) => s.liveSessions)
  const focusOrOpenSession = useAppStore((s) => s.focusOrOpenSession)
  const load = useHandoffsStore((s) => s.load)
  const repoLabel = handoff.targetRepoLabel ?? handoff.targetRepoId
  const hasDetail =
    (handoff.status === 'done' && !!handoff.summary) ||
    (handoff.status === 'failed' && !!handoff.error) ||
    (handoff.status === 'interrupted' && !!handoff.error)

  // Sem heartbeat: só faz sentido pra running. Calculado no render — a lista
  // recarrega periodicamente via watch, mantendo o "há Xh" razoavelmente fresco.
  const stale = isStale(handoff, ttlHours, Date.now())

  // Recovery manual: força failed via IPC handoffs:fail. Disponível pra running e
  // pra approved travado (aprovado mas a filha nunca subiu). Confirmação evita
  // matar uma filha viva em trabalho longo por engano.
  const canForceFail = handoff.status === 'running' || handoff.status === 'approved'

  // Feedback de utilidade: só faz sentido pra handoffs concluídos. Persiste via
  // IPC e recarrega pra refletir o outcome marcado. Idempotente no backend.
  const canRate = handoff.status === 'done'

  // Retomar: só pra handoffs interrompidos (filha morreu sem erro real). O botão
  // só aparece se o backend confirma que o transcript da filha ainda existe
  // (is-resumable) — senão não há de onde retomar via `claude --resume`.
  const isInterrupted = handoff.status === 'interrupted'

  useEffect(() => {
    if (!isInterrupted) {
      setResumable(false)
      return
    }
    let cancelled = false
    void handoffsApi
      .isResumable(handoff.id)
      .then((ok) => {
        if (!cancelled) setResumable(ok)
      })
      .catch(() => {
        if (!cancelled) setResumable(false)
      })
    return () => {
      cancelled = true
    }
  }, [isInterrupted, handoff.id])

  async function resume() {
    if (resuming) return
    setResuming(true)
    try {
      await handoffsApi.resume(handoff.id)
      await load()
    } catch {
      // O load() seguinte ressincroniza o status. Mantém o botão habilitável pra
      // nova tentativa (a filha pode ter ficado não-resumível nesse meio-tempo).
      setResuming(false)
    }
  }

  async function rate(outcome: HandoffOutcome) {
    if (rating) return
    setRating(true)
    try {
      await handoffsApi.setOutcome({ id: handoff.id, outcome })
      await load()
    } catch {
      // Falha silenciosa: o load() seguinte ressincroniza. Não bloqueia a UI.
    } finally {
      setRating(false)
    }
  }

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

  // A filha está num PTY enquanto o handoff está vivo (running OU needs_input —
  // needs_input é um estado vivo dentro de running). "Abrir terminal" RE-ATTACHA
  // uma pane à sessão viva (focusOrOpenSession → paneFromLiveSession), nunca
  // re-spawn/--resume. Só aparece em liveSessions enquanto a PTY existe.
  const isLiveHandoff = handoff.status === 'running' || handoff.status === 'needs_input'
  const childLive =
    isLiveHandoff && handoff.childSessionId
      ? liveSessions.find((s) => s.id === handoff.childSessionId)
      : undefined

  // Sinais vivos da filha. badge.attention (waiting/ended) ou needs_input pedem
  // realce âmbar. needs_input vence: a mãe pediu input explícito.
  const live = isLiveHandoff ? liveBadgeFor(childLive?.status) : null
  const needsInput = handoff.status === 'needs_input'
  const highlight = needsInput || (live?.attention ?? false)
  const lastText = childLive?.lastText?.trim() || null
  const activityLabel = liveActivityLabel(childLive?.lastActivityAt ?? null, Date.now())
  const ctxLabel = contextLabel(childLive?.tokens)

  // Input de intervenção: só quando a filha está VIVA (childLive presente). Em
  // needs_input/waiting o tom vira "Responder" com placeholder contextual.
  const canSend = !!childLive
  const sendLabel = needsInput || childLive?.status === 'waiting' ? 'Responder' : 'Enviar'
  const sendPlaceholder = needsInput
    ? 'Responder à pergunta da filha…'
    : 'Enviar mensagem para a filha…'

  async function sendMessage() {
    const text = message.trim()
    if (!text || sending || !childLive) return
    setSending(true)
    try {
      await handoffsApi.sendMessage({ id: handoff.id, text })
      setMessage('')
    } catch {
      // Falha (filha morreu entre o render e o envio): o load() seguinte atualiza
      // o liveness e o input some. Mantém o texto pro usuário não perder o que digitou.
    } finally {
      setSending(false)
      await load()
    }
  }

  return (
    <div
      className="rounded-md border bg-[var(--color-surface)] p-3"
      style={{
        borderColor: highlight ? 'var(--color-warning)' : 'var(--color-border)',
        background: highlight ? 'var(--color-warning)0d' : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--color-text)]">
              → {repoLabel}
            </span>
            <StatusBadge status={handoff.status} />
            {live && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: live.color, borderColor: live.color, background: `${live.color}1a` }}
                title="Estado ao vivo da sessão-filha"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: live.color }}
                />
                {live.label}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-[var(--color-text-dim)]">{handoff.task}</div>
          {isLiveHandoff && handoff.currentStep && (
            <div className="mt-1 truncate text-xs text-[var(--color-info)]" title={handoff.currentStep}>
              {handoff.currentStep}
            </div>
          )}
          {lastText && (
            <div
              className="mt-1 truncate text-xs text-[var(--color-text-dim)]"
              title={childLive?.lastText ?? undefined}
            >
              {lastText}
            </div>
          )}
          {(activityLabel || ctxLabel) && (
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-text-dim)]">
              {activityLabel && <span title="Última atividade da filha">{activityLabel}</span>}
              {ctxLabel && <span title="Tokens de contexto em uso">{ctxLabel}</span>}
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
          {isInterrupted && resumable && (
            <button
              type="button"
              onClick={() => void resume()}
              disabled={resuming}
              title="Re-spawnar a sessão-filha e retomar de onde parou"
              className="flex items-center gap-1 rounded border border-[var(--color-accent)]/50 px-2 py-0.5 text-[11px] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10 disabled:opacity-50"
            >
              <Icon as={Play} size={12} />
              {resuming ? 'Retomando…' : 'Retomar'}
            </button>
          )}
        </div>
      </div>

      {needsInput && handoff.pendingQuestion && (
        <div
          className="mt-2 rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--color-warning)',
            background: 'var(--color-warning)14',
            color: 'var(--color-text)',
          }}
        >
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--color-warning)]">
            <Icon as={AlertTriangle} size={12} />
            A filha perguntou:
          </div>
          <div className="whitespace-pre-wrap">{handoff.pendingQuestion}</div>
        </div>
      )}

      {canSend && (
        <form
          className="mt-2 flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage()
          }}
        >
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia; Shift+Enter quebra linha (multi-linha íntegra via
              // bracketed-paste no main).
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
            rows={1}
            placeholder={sendPlaceholder}
            className="min-h-[32px] flex-1 resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={sending || message.trim().length === 0}
            title={`${sendLabel} (Enter)`}
            className="flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-40"
            style={{
              color: highlight ? 'var(--color-warning)' : 'var(--color-accent)',
              borderColor: highlight ? 'var(--color-warning)' : 'var(--color-accent)',
            }}
          >
            <Icon as={needsInput || childLive?.status === 'waiting' ? CornerDownLeft : Send} size={12} />
            {sending ? 'Enviando…' : sendLabel}
          </button>
        </form>
      )}

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
                : handoff.status === 'interrupted'
                  ? 'Ver motivo'
                  : 'Ver erro'}
          </button>
          {expanded && (
            <pre
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-xs"
              style={{
                color:
                  handoff.status === 'failed'
                    ? 'var(--color-danger)'
                    : handoff.status === 'interrupted'
                      ? 'var(--color-warning)'
                      : 'var(--color-text)',
              }}
            >
              {handoff.status === 'done' ? handoff.summary : handoff.error}
            </pre>
          )}
        </div>
      )}

      {canRate && (
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--color-border)] pt-2">
          <span className="text-[11px] text-[var(--color-text-dim)]">Foi útil?</span>
          <OutcomeButton
            active={handoff.outcome === 'useful'}
            disabled={rating}
            onClick={() => void rate('useful')}
            icon={ThumbsUp}
            label="Útil"
            color="var(--color-success)"
          />
          <OutcomeButton
            active={handoff.outcome === 'partial'}
            disabled={rating}
            onClick={() => void rate('partial')}
            icon={CircleSlash}
            label="Parcial"
            color="var(--color-warning)"
          />
          <OutcomeButton
            active={handoff.outcome === 'wrong'}
            disabled={rating}
            onClick={() => void rate('wrong')}
            icon={ThumbsDown}
            label="Errou"
            color="var(--color-danger)"
          />
        </div>
      )}
    </div>
  )
}

function OutcomeButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  icon: typeof ThumbsUp
  label: string
  color: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50"
      style={{
        color: active ? color : 'var(--color-text-dim)',
        borderColor: active ? color : 'var(--color-border)',
        background: active ? `${color}1a` : undefined,
      }}
    >
      <Icon as={icon} size={12} />
      {label}
    </button>
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
