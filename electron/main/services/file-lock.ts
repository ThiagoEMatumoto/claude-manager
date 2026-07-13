// Fila de promises por path: serializa mutações do mesmo arquivo. O
// settings.json é alvo de read-modify-write por superfícies diferentes (toggle
// de hooks, editor de settings) — sem serialização, dois toggles rápidos
// interleiam e o segundo write ressuscita a entry que o primeiro removeu
// (lost update). Não é reentrante: quem já está dentro do lock não pode chamar
// withFileLock de novo pro mesmo path (deadlock por esperar a si mesmo).
const queues = new Map<string, Promise<void>>()

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(path) ?? Promise.resolve()
  // Encadeia mesmo se o anterior falhou — erro de um caller não trava a fila.
  const run = prev.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  queues.set(path, tail)
  void tail.then(() => {
    // Remove a fila quando este é o último da cadeia, pra não vazar o Map.
    if (queues.get(path) === tail) queues.delete(path)
  })
  return run
}
