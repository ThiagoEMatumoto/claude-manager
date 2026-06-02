import type { Feature } from '../../../shared/types/ipc'

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s).split(/\s+/).filter(Boolean)
}

// Score client-side sem lib: combina substring (peso alto) + overlap de tokens
// (Jaccard sobre os termos do título vs os do objetivo). 0..1.
export function matchScore(query: string, feature: Feature): number {
  const q = normalize(query)
  if (!q) return 0
  const title = normalize(feature.title)
  const objective = normalize(feature.objective ?? '')

  let substr = 0
  if (title.includes(q) || q.includes(title)) substr = 1
  else if (objective.includes(q)) substr = 0.6

  const qTokens = new Set(tokens(query))
  const fTokens = new Set([...tokens(feature.title), ...tokens(feature.objective ?? '')])
  let inter = 0
  for (const t of qTokens) if (fTokens.has(t)) inter++
  const union = new Set([...qTokens, ...fTokens]).size
  const overlap = union === 0 ? 0 : inter / union

  return Math.max(substr, overlap)
}

// Top sugestões acima de um limiar, ordenadas por score desc.
export function suggestFeatures(
  query: string,
  features: Feature[],
  limit = 3,
  threshold = 0.18,
): { feature: Feature; score: number }[] {
  return features
    .map((feature) => ({ feature, score: matchScore(query, feature) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
