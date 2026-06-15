// Mutex async compartilhado por TUDO que toca o working tree do git de sync
// (coordinator flushInternal + handlers IPC sync:now/export-force/import-force/
// resolve-conflict/import-force). Sem ele, um push do coordinator e um sync:now
// manual rodariam `git` concorrente na MESMA working tree → corrupção / lock
// file conflicts.
//
// Implementação: fila via promise chain. Cada chamada encadeia depois da
// anterior; a tail é a última promise da fila. Garante ordem FIFO e exclusão
// mútua sem polling.

let tail: Promise<unknown> = Promise.resolve()

// Executa `fn` exclusivamente: só começa após a operação anterior terminar
// (sucesso OU erro). Propaga o resultado/erro de `fn` ao caller, sem deixar um
// erro envenenar a fila (o próximo na fila roda mesmo se este lançar).
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  // O próximo espera o término deste (resolvido ou rejeitado), por isso o
  // `.catch` que descarta o erro na corrente da fila — o erro real vai pro
  // caller via `result`.
  const result = tail.then(fn, fn)
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
