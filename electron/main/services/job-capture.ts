import * as jobStore from './scheduled-job-store'
import { getActivityFor, MAX_TEXT, type ActivitySnapshot } from './session-activity'
import type { CaptureQuality, JobRun } from '../../../shared/types/ipc'

// Captura PULL do relatório de um Scheduled Job no evento 'exit' do PTY (Fase 2).
// Liga sessão→run por session_id, lê o transcript via getActivityFor (lastText +
// tokens) e finaliza a run: success (exit 0) ou failed. Marca capture_quality
// (none/partial/full) em vez de falhar em silêncio quando não há texto.
//
// O transcript JSONL pode não ter sido flushado no exato instante do exit. Se a
// sessão saiu limpa (exit 0) SEM texto, tenta UMA vez mais após um curto delay —
// a run fica 'running' até o retry pra não marcar success sem relatório.

const RETRY_DELAY_MS = 3000

export interface JobCaptureDeps {
  getRunningRun?: (sessionId: string) => JobRun | null
  getActivity?: (ccSessionId: string) => ActivitySnapshot | null
  updateRun?: (input: Parameters<typeof jobStore.updateRun>[0]) => JobRun
  now?: () => number
  // Agenda o retry único (default: setTimeout unref). Injetável p/ teste.
  scheduleRetry?: (fn: () => void) => void
}

// tokens single-number: soma output + context da última msg assistant (snapshot
// do último turno, não cumulativo — sem consumidor até a Fase 3). null se ausente.
function reduceTokens(activity: ActivitySnapshot | null): number | null {
  const t = activity?.tokens
  return t ? t.output + t.context : null
}

function classifyCapture(lastText: string | null): CaptureQuality {
  if (!lastText) return 'none'
  // deriveEnrichment já faz slice(0, MAX_TEXT); comprimento no teto = truncado.
  return lastText.length >= MAX_TEXT ? 'partial' : 'full'
}

export function captureJobRunOnExit(
  sessionId: string,
  exitCode: number,
  deps: JobCaptureDeps = {},
  isRetry = false,
): void {
  const getRunningRun = deps.getRunningRun ?? jobStore.getRunningRunBySession
  const getActivity = deps.getActivity ?? getActivityFor
  const updateRun = deps.updateRun ?? jobStore.updateRun
  const now = deps.now ?? (() => Date.now())
  const scheduleRetry =
    deps.scheduleRetry ??
    ((fn: () => void) => {
      const t = setTimeout(fn, RETRY_DELAY_MS)
      t.unref?.()
    })

  const run = getRunningRun(sessionId)
  // Sessão que não é de um job (ou run já capturada): nada a fazer.
  if (!run || !run.ccSessionId) return

  const activity = getActivity(run.ccSessionId)
  const lastText = activity?.lastText ?? null

  // Retry curto único: transcript ainda não flushado num exit limpo. Mantém a run
  // 'running' (não toca no status) até a 2ª tentativa.
  if (exitCode === 0 && !lastText && !isRetry) {
    scheduleRetry(() => captureJobRunOnExit(sessionId, exitCode, deps, true))
    return
  }

  updateRun({
    id: run.id,
    status: exitCode === 0 ? 'success' : 'failed',
    reportText: lastText,
    tokens: reduceTokens(activity),
    captureQuality: classifyCapture(lastText),
    finishedAt: now(),
    error: exitCode === 0 ? null : `Sessão encerrou com exit code ${exitCode}.`,
  })
}
