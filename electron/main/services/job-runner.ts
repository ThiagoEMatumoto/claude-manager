import { spawnSession } from '../ipc/sessions'
import type { AdvisorModel, EffortLevel, PermissionMode } from '../../../shared/types/ipc'

// Primitivo de spawn programático de sessão para Scheduled Jobs (Fase 1). O
// spawn "normal" nasce no renderer (handoffsStore.spawnSessionBackground), fora
// do alcance do processo main; o scheduler (Fase 2) vai precisar disparar SEM
// renderer. Este serviço compõe o kickoff e reusa spawnSession (a lógica pura
// extraída de sessions.ts, por cima de startSession/ptyManager).
//
// NÃO implementa scheduler nem captura de resultado (Fase 2) — só o disparo.

// Snapshot self-contained dos params resolvidos do job (nada de lookup de preset
// aqui): o caller (scheduler, Fase 2) passa exatamente o que foi gravado na row.
export interface SpawnJobSessionParams {
  repoId: string | null
  // Nome da sessão spawnada (ex.: o nome do job). Default do repo se vazio.
  name?: string | null
  prompt: string
  systemPrompt?: string | null
  model?: string | null
  effort?: EffortLevel | null
  // Observe-only por padrão: sem opt-in explícito, a sessão sobe read-only.
  permissionMode?: PermissionMode | null
  advisorModel?: AdvisorModel | null
  disallowedTools?: string[] | null
}

export interface SpawnJobSessionResult {
  // sessions.id interno (usado pra reconciliar/kill).
  sessionId: string
  // id da sessão Claude Code (usado pra achar o transcript na captura, Fase 2).
  ccSessionId: string
}

// Observe-only: sem write/commit. Modo autônomo exige opt-in explícito por job.
const DEFAULT_PERMISSION_MODE: PermissionMode = 'plan'

// Compõe o kickoff do job. Fase 1: o prompt do job JÁ carrega a instrução de
// crítica/relatório (template imposto pelo prompt). O delta-via-prompt (injetar o
// run anterior) e a captura são Fase 2/4 — aqui o prompt vira o 1º turno direto.
function composeKickoff(params: SpawnJobSessionParams): string {
  return params.prompt
}

// Dispara a sessão do job em BACKGROUND (sem pane), entregando o kickoff via
// initialPrompt POSICIONAL (`claude [flags] "<prompt>"`, auto-submit do 1º turno)
// — o caminho confiável sem UI, ao contrário de injectInitialCommandOnFirstData
// (frágil sem resize do TUI). Retorna os ids da sessão criada.
export function spawnJobSession(params: SpawnJobSessionParams): SpawnJobSessionResult {
  const session = spawnSession({
    repoId: params.repoId,
    name: params.name ?? undefined,
    initialPrompt: composeKickoff(params),
    systemPromptText: params.systemPrompt ?? undefined,
    model: params.model ?? undefined,
    effort: params.effort ?? undefined,
    permissionMode: params.permissionMode ?? DEFAULT_PERMISSION_MODE,
    advisorModel: params.advisorModel ?? undefined,
    disallowedTools: params.disallowedTools ?? undefined,
  })

  // spawnSession sempre grava cc_session_id (== o session-id gerado); o guard
  // torna o contrato explícito para o caller (a captura da Fase 2 depende dele).
  if (!session.ccSessionId) {
    throw new Error('spawnJobSession: sessão criada sem ccSessionId')
  }

  return { sessionId: session.id, ccSessionId: session.ccSessionId }
}
