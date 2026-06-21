// Mapeia `items` com `fn` mantendo no máximo `limit` chamadas em voo. Preserva a
// ordem do resultado (out[i] corresponde a items[i]) e propaga o primeiro erro.
// Usado em fetch/extract/verify do funil de dossiê pra respeitar o cap de ~6
// agentes concorrentes (a lição da run que auto-causou rate-limit).
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error(`mapWithConcurrency: limit must be >= 1, got ${limit}`)
  const out = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return out
}
