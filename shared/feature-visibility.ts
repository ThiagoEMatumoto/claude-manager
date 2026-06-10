import type { FeatureOrigin } from './types/ipc'

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
