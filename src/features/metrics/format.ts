export function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDateTime(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString('pt-BR')
}
