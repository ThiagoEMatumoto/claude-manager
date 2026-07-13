// Substring match case/acento-insensível, simples e previsível — util único
// compartilhado por CommandPalette e SessionSwitcher (antes duplicado nos dois).
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true
  const q = normalize(query)
  return fields.some((f) => f && normalize(f).includes(q))
}
