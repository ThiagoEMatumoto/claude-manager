import type {
  FeatureStatus,
  KeyResultStatus,
  ProgressDirection,
  ProgressMode,
  TaskStatus,
} from './types/ipc'

// Cálculo puro de progresso (0–100 | null) de Objetivos/KRs — importável por
// main e renderer (precedente: shared/metrics-targets.ts). null = indeterminado
// (a UI mostra "—"). O progresso NUNCA é persistido; é derivado em list/get.

export interface ProgressInput {
  progressMode: ProgressMode
  progressManual: number | null
  baseline: number | null
  current: number | null
  target: number | null
  direction: ProgressDirection | null
}

export interface ProgressChild {
  // KRs e tarefas compartilham a mesma regra de exclusão: 'cancelled' sai do
  // rollup (numerador e denominador); os demais status só carregam o progress.
  status: KeyResultStatus | TaskStatus
  // Peso no rollup (null = 1).
  weight: number | null
  // Progresso já calculado do filho. null = não iniciado/não medido: sai do
  // rollup (numerador E denominador) — regra única (Onda 0). Filho iniciado
  // sem progresso mensurável ainda entra como 0 explícito, não null.
  progress: number | null
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function metricProgress(entity: ProgressInput): number | null {
  const { baseline, current, target, direction } = entity
  if (direction === 'maintain') {
    if (current === null || target === null) return null
    return current === target ? 100 : 0
  }
  if (direction === null || baseline === null || current === null || target === null) return null
  if (target === baseline) return null
  const ratio =
    direction === 'increase'
      ? (current - baseline) / (target - baseline)
      : (baseline - current) / (baseline - target)
  return clamp(ratio * 100)
}

function rollupProgress(children?: ProgressChild[]): number | null {
  // Cancelled OU progresso null (não iniciado/não medido) saem do rollup —
  // numerador E denominador (regra única, Onda 0: antes um KR sem measurement
  // contava como 0 falso enquanto ocupava o denominador; agora sai igual a
  // uma feature nunca iniciada). Filho com progresso explícito, mesmo 0,
  // conta normalmente.
  const eligible = (children ?? []).filter(
    (c): c is ProgressChild & { progress: number } => c.status !== 'cancelled' && c.progress !== null,
  )
  if (eligible.length === 0) return null
  let weightSum = 0
  let weighted = 0
  for (const c of eligible) {
    const weight = c.weight ?? 1
    weightSum += weight
    weighted += weight * c.progress
  }
  if (weightSum === 0) return null
  return clamp(weighted / weightSum)
}

export function computeProgress(
  entity: ProgressInput,
  children?: ProgressChild[],
): number | null {
  switch (entity.progressMode) {
    case 'manual':
      return entity.progressManual === null ? null : clamp(entity.progressManual)
    case 'metric':
      return metricProgress(entity)
    case 'auto_rollup':
      return rollupProgress(children)
  }
}

// ---- Tarefas como filhos de rollup (Fase 2) ----

// Tarefa vira filho binário do rollup: done = 100, qualquer outro status = 0.
// O status é repassado para que 'cancelled' saia do denominador em rollupProgress.
export function taskProgressChild(status: TaskStatus): ProgressChild {
  return { status, weight: null, progress: status === 'done' ? 100 : 0 }
}

// % de tarefas done (cancelled fora; lista vazia → null). Reusa o mesmo
// rollup ponderado de computeProgress/auto_rollup com peso uniforme.
export function computeTaskRollup(statuses: TaskStatus[]): number | null {
  return rollupProgress(statuses.map(taskProgressChild))
}

// ---- Features como filhos de rollup (Fase 3) ----

// Subconjunto da Feature que o rollup precisa enxergar (status + arquivamento).
export interface FeatureRollupSource {
  status: FeatureStatus
  archivedAt: number | null
}

// Progresso de uma feature: % de tarefas done vinculadas a ela. Sem tarefas
// elegíveis (nenhuma, ou todas cancelled), cai pro status da feature: done →
// 100; 'pending' (nunca iniciada) → null (indeterminado, fora do rollup do
// pai); demais status (in-progress/blocked/paused — já começou) → 0 explícito
// em vez de sumir (regra única de null, Onda 0).
export function computeFeatureProgress(
  status: FeatureStatus,
  taskStatuses: TaskStatus[],
): number | null {
  const rollup = computeTaskRollup(taskStatuses)
  if (rollup !== null) return rollup
  if (status === 'done') return 100
  return status === 'pending' ? null : 0
}

// ---- Tom semântico da ProgressBar (Onda 1) ----

export type ProgressTone = 'accent' | 'warning' | 'danger'

export interface ScheduleToneInput {
  progress: number | null
  startDate: number | null
  endDate: number | null
}

// Compara progresso% vs % do prazo já decorrido (startDate→endDate). Sem
// prazo definido (falta start ou end, ou intervalo inválido) ou progresso
// indeterminado, não dá pra avaliar atraso — mantém o accent neutro. Atraso
// (tempo decorrido à frente do progresso) > 15 pontos = warning, > 30 = danger.
export function objectiveProgressTone(input: ScheduleToneInput, now: number = Date.now()): ProgressTone {
  const { progress, startDate, endDate } = input
  if (progress === null || startDate === null || endDate === null || endDate <= startDate) {
    return 'accent'
  }
  const elapsedPct = clamp(((now - startDate) / (endDate - startDate)) * 100)
  const gap = elapsedPct - progress
  if (gap > 30) return 'danger'
  if (gap > 15) return 'warning'
  return 'accent'
}

// Feature como filho de rollup (peso 1). Retorna null quando a feature deve
// ficar FORA do denominador (arquivada, ou 'pending' sem tasks — indeterminado)
// — rollupProgress também filtra progress null, mas resolver aqui evita
// carregar um ProgressChild fantasma. FeatureStatus não tem 'cancelled', então
// o status emitido é a sentinela não-cancelled 'active'.
export function featureProgressChild(
  feature: FeatureRollupSource,
  taskStatuses: TaskStatus[],
): ProgressChild | null {
  if (feature.archivedAt !== null) return null
  const progress = computeFeatureProgress(feature.status, taskStatuses)
  if (progress === null) return null
  return { status: 'active', weight: null, progress }
}
