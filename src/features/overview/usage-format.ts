// Formatadores compactos dos números de uso da Home (tiles, chart, side stats).

export function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

// 8.4M / 320k / 950 — compacto pra tiles e tooltip.
export function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

export function fmtInt(value: number): string {
  return value.toLocaleString('pt-BR')
}

// claude-sonnet-4-5-20250929 → sonnet-4-5 (corta vendor prefix e date suffix).
export function fmtModelName(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}
