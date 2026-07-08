import type { JobMetrics } from '../../../shared/types/ipc'

// Parser das métricas de um web-audit. Função PURA (sem I/O, sem electron): o
// relatório da sessão termina com um bloco ```json com { lcp, ttfb, consoleErrors,
// networkFailures } (ver webAuditPlaybook em job-kickoff.ts). BEST-EFFORT: qualquer
// desvio (ausência, JSON inválido, chaves não-numéricas) → null; NUNCA lança, nunca
// quebra o run. A captura de métricas é um bônus, não um requisito da execução.

const FENCE_RE = /```json\s*([\s\S]*?)```/gi

// Só number finito é métrica; NaN/Infinity/string/bool/objeto → null. Usar typeof +
// Number.isFinite (NUNCA truthiness): consoleErrors=0 é valor VÁLIDO, não ausência.
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Extrai o ÚLTIMO bloco ```json do texto (o relatório pode ter blocos json de
// exemplo antes; o de métricas é sempre o final) e coage as 4 chaves. Retorna null
// se não houver bloco, o JSON não parsear, ou nenhuma chave numérica válida sobrar
// (não é um bloco de métricas — evita gravar um objeto all-null inútil).
export function parseMetricsBlock(reportText: string | null | undefined): JobMetrics | null {
  if (!reportText) return null

  const matches = [...reportText.matchAll(FENCE_RE)]
  if (matches.length === 0) return null

  const raw = matches[matches.length - 1]![1]?.trim()
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const obj = parsed as Record<string, unknown>
  const metrics: JobMetrics = {
    lcp: numOrNull(obj.lcp),
    ttfb: numOrNull(obj.ttfb),
    consoleErrors: numOrNull(obj.consoleErrors),
    networkFailures: numOrNull(obj.networkFailures),
  }

  const hasAny = Object.values(metrics).some((v) => v !== null)
  return hasAny ? metrics : null
}
