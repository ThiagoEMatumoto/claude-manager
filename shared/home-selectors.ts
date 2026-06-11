import { classifyDue, comparePendingTasks } from './pending'
import type { PendingOrderInput } from './pending'
import type { ObjectiveStatus, TaskStatus } from './types/ipc'

// Selectors puros da Home (grid 2×2 do Overview) — importáveis por main e
// renderer (precedente: shared/pending.ts). Recebem shapes estruturais mínimos
// pra os testes não precisarem montar entidades completas.

// ---- Tasks urgentes (card 2) ----

// Campos mínimos pra urgência: status + ordenação canônica de pendências.
export interface UrgentTaskInput extends PendingOrderInput {
  status: TaskStatus
}

// Urgentes em 3 faixas, nesta ordem: vencidas → vencem hoje → em andamento
// (sem due urgente). Dentro de cada faixa, ordenação canônica de pendências
// (prioridade → dueDate → position). Faixas são disjuntas: uma in_progress
// vencida aparece só na faixa de vencidas.
export function selectUrgentTasks<T extends UrgentTaskInput>(tasks: T[], now: number): T[] {
  const overdue: T[] = []
  const today: T[] = []
  const doing: T[] = []
  for (const t of tasks) {
    const bucket = classifyDue(t.dueDate, now)
    if (bucket === 'overdue') overdue.push(t)
    else if (bucket === 'today') today.push(t)
    else if (t.status === 'in_progress') doing.push(t)
  }
  return [
    ...overdue.sort(comparePendingTasks),
    ...today.sort(comparePendingTasks),
    ...doing.sort(comparePendingTasks),
  ]
}

// ---- Sessões agora (card 1) ----

export type LiveStatus = 'starting' | 'working' | 'waiting' | 'idle' | 'ended'

export interface LiveStatusInput {
  status: LiveStatus
}

export interface LiveSessionGroups<T> {
  // Aguardando você (status waiting) — pede ação, vem primeiro.
  waiting: T[]
  // Trabalhando (working|starting — mesmo glifo girando do SessionStrip).
  working: T[]
  // Ociosas (idle) — vivas mas paradas.
  idle: T[]
}

// Espelha o critério do SessionStrip: ended fica fora; todo o resto aparece.
// Ordem dentro de cada grupo = ordem de entrada (a do snapshot global).
export function groupLiveSessions<T extends LiveStatusInput>(sessions: T[]): LiveSessionGroups<T> {
  const groups: LiveSessionGroups<T> = { waiting: [], working: [], idle: [] }
  for (const s of sessions) {
    if (s.status === 'ended') continue
    if (s.status === 'waiting') groups.waiting.push(s)
    else if (s.status === 'working' || s.status === 'starting') groups.working.push(s)
    else groups.idle.push(s)
  }
  return groups
}

// ---- Features em andamento (card 3) ----

export const STALLED_FEATURE_MS = 3 * 24 * 60 * 60 * 1000

export interface FeatureActivityInput {
  lastSessionAt: number | null
}

// Parada = teve sessão e a última foi há mais de 3 dias. Sem sessão nenhuma
// (lastSessionAt null) NÃO é parada — é "sem registros" (higiene da frente A).
export function isStalledFeature(feature: FeatureActivityInput, now: number): boolean {
  return feature.lastSessionAt !== null && now - feature.lastSessionAt > STALLED_FEATURE_MS
}

// ---- Objetivos ativos (card 4) ----

export interface ObjectiveNodeInput {
  objective: { status: ObjectiveStatus }
}

// Raízes com status active (o agregado já exclui archived; paused|done ficam
// fora do card — continuam visíveis na árvore colapsável).
export function selectActiveObjectives<T extends ObjectiveNodeInput>(roots: T[]): T[] {
  return roots.filter((n) => n.objective.status === 'active')
}

// ---- Uso do Claude (hero / stats da Home) ----

// Shape estrutural mínimo de MetricsDayPoint (mesmo padrão dos demais inputs).
export interface UsageDayPoint {
  day: string
  tokens: number
  costUsd: number
  turns: number
  sessions: number
}

const DAY_MS = 24 * 60 * 60 * 1000

// Chave de dia em UTC — espelha o dayKey do metrics-service (per_day_json é
// bucketizado por toISOString), senão "hoje" não casaria perto da meia-noite.
export function usageDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export interface TodayUsage {
  costUsd: number
  tokens: number
  turns: number
}

export function selectTodayUsage(perDay: UsageDayPoint[], now: number): TodayUsage {
  const key = usageDayKey(now)
  const point = perDay.find((p) => p.day === key)
  return point
    ? { costUsd: point.costUsd, tokens: point.tokens, turns: point.turns }
    : { costUsd: 0, tokens: 0, turns: 0 }
}

export interface WindowUsage {
  costUsd: number
  tokens: number
  turns: number
  // soma dos sessions diários (sessões que tocaram cada dia) — aproximação
  // suficiente pro tile; sessões multi-dia contam em cada dia tocado.
  sessions: number
}

export interface RecentUsage {
  current: WindowUsage
  previous: WindowUsage
  // (current − previous) / previous × 100 sobre custo; null sem base anterior.
  costDeltaPct: number | null
}

function emptyWindow(): WindowUsage {
  return { costUsd: 0, tokens: 0, turns: 0, sessions: 0 }
}

function addPoint(acc: WindowUsage, p: UsageDayPoint): void {
  acc.costUsd += p.costUsd
  acc.tokens += p.tokens
  acc.turns += p.turns
  acc.sessions += p.sessions
}

// Janela corrente = últimos `days` dias UTC (hoje inclusive); anterior = os
// `days` imediatamente antes. Dias fora das duas janelas são ignorados.
export function selectRecentUsage(perDay: UsageDayPoint[], now: number, days = 7): RecentUsage {
  const currentKeys = new Set<string>()
  const previousKeys = new Set<string>()
  for (let i = 0; i < days; i++) {
    currentKeys.add(usageDayKey(now - i * DAY_MS))
    previousKeys.add(usageDayKey(now - (i + days) * DAY_MS))
  }

  const current = emptyWindow()
  const previous = emptyWindow()
  for (const p of perDay) {
    if (currentKeys.has(p.day)) addPoint(current, p)
    else if (previousKeys.has(p.day)) addPoint(previous, p)
  }

  const costDeltaPct =
    previous.costUsd > 0 ? ((current.costUsd - previous.costUsd) / previous.costUsd) * 100 : null

  return { current, previous, costDeltaPct }
}
