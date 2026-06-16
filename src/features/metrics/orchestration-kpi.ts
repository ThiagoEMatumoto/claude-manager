// Helpers puros que alimentam a leitura semântica dos cards de KPI de
// orquestração (status vs meta, tendência vs janela anterior, formatação).

export type KpiStatus = 'above' | 'below'

export interface KpiDelta {
  // diferença absoluta em razão (current - previous), ex: 0.042
  abs: number
  dir: 'up' | 'down' | 'flat'
}

const FLAT_EPSILON = 1e-9

export function kpiStatus(value: number, target: number): KpiStatus {
  return value >= target ? 'above' : 'below'
}

export type BandTone = 'good' | 'watch' | 'bad'

export interface Band {
  label: BandTone
  tone: BandTone
}

// Health bands canônicas do manager-mode score (espelha kz_dashboard
// health.py band_manager): >=0.30 good | >=0.15 watch | <0.15 bad.
// Bordas usam >= para o threshold contar na categoria melhor.
export function bandFor(value: number): Band {
  if (value >= 0.3) return { label: 'good', tone: 'good' }
  if (value >= 0.15) return { label: 'watch', tone: 'watch' }
  return { label: 'bad', tone: 'bad' }
}

// null quando não há janela anterior pra comparar (ex: janela 'all').
export function computeDelta(current: number, previous: number | undefined | null): KpiDelta | null {
  if (previous === undefined || previous === null) return null
  const abs = current - previous
  const dir = Math.abs(abs) < FLAT_EPSILON ? 'flat' : abs > 0 ? 'up' : 'down'
  return { abs, dir }
}

export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

export function formatDelta(delta: KpiDelta): string {
  const magnitude = Math.abs(delta.abs) * 100
  const sign = delta.dir === 'up' ? '+' : delta.dir === 'down' ? '−' : ''
  return `${sign}${magnitude.toFixed(1)} pp`
}
