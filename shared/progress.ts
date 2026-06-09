import type { KeyResultStatus, ProgressDirection, ProgressMode } from './types/ipc'

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
  status: KeyResultStatus
  // Peso no rollup (null = 1).
  weight: number | null
  // Progresso já calculado do filho (null conta como 0 no numerador).
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
  // KRs cancelled saem do rollup (numerador E denominador).
  const eligible = (children ?? []).filter((c) => c.status !== 'cancelled')
  if (eligible.length === 0) return null
  let weightSum = 0
  let weighted = 0
  for (const c of eligible) {
    const weight = c.weight ?? 1
    weightSum += weight
    weighted += weight * (c.progress ?? 0)
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
