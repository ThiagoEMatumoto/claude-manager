// Tempo relativo curto em pt-BR ("agora", "há 2min", "há 3h", "há 2d").
export function relativeTime(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const sec = Math.round(diff / 1000)
  if (sec < 45) return 'agora'
  const min = Math.round(sec / 60)
  if (min < 60) return `há ${min}min`
  const hours = Math.round(min / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  return `há ${days}d`
}
