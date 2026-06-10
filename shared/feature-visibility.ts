import type { FeatureOrigin, FeatureStatus } from './types/ipc'

// Regras de visibilidade de features (puras, compartilhadas entre main e renderer).
//
// Rascunho oculto = feature auto-criada (origin='auto') que ainda não tem nenhum
// session record. A visibilidade é DERIVADA — não existe flag mutável: quando o
// 1º registro é gravado em feature_session_records, a feature aparece sozinha.

export function isDraftFeature(origin: FeatureOrigin, recordCount: number): boolean {
  return origin === 'auto' && recordCount === 0
}

// Visível na listagem padrão: não-arquivada e não-rascunho.
export function isListedFeature(
  origin: FeatureOrigin,
  recordCount: number,
  archivedAt: number | null,
): boolean {
  return archivedAt === null && !isDraftFeature(origin, recordCount)
}

// Badge "parada há Nd": feature que deveria estar andando (in-progress/blocked)
// sem atividade real há mais de 14 dias. lastActivityAt = lastRecordAt quando
// existe, senão updatedAt. Retorna os dias parados, ou null se não se aplica.
// SEM auto-archive: badge informa, o archive é decisão manual no card.
export const STALLED_THRESHOLD_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export function stalledDays(
  status: FeatureStatus,
  lastActivityAt: number,
  now: number = Date.now(),
): number | null {
  if (status !== 'in-progress' && status !== 'blocked') return null
  const days = Math.floor((now - lastActivityAt) / DAY_MS)
  return days > STALLED_THRESHOLD_DAYS ? days : null
}
