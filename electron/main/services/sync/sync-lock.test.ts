import { describe, expect, it } from 'vitest'
import { withSyncLock } from './sync-lock'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('withSyncLock', () => {
  it('1. (#4) duas operações concorrentes NÃO se sobrepõem (a 2ª só começa após a 1ª)', async () => {
    const order: string[] = []

    const op1 = withSyncLock(async () => {
      order.push('1-start')
      await sleep(30)
      order.push('1-end')
    })
    // Dispara a 2ª enquanto a 1ª ainda roda — deve enfileirar.
    const op2 = withSyncLock(async () => {
      order.push('2-start')
      await sleep(5)
      order.push('2-end')
    })

    await Promise.all([op1, op2])

    // Exclusão mútua: 2-start só depois de 1-end (sem interleaving).
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end'])
  })

  it('2. um erro numa operação NÃO envenena a fila (a próxima ainda roda)', async () => {
    const order: string[] = []

    const failing = withSyncLock(async () => {
      order.push('fail-start')
      throw new Error('boom')
    })
    const next = withSyncLock(async () => {
      order.push('next-start')
      return 42
    })

    await expect(failing).rejects.toThrow('boom') // o erro chega ao caller
    await expect(next).resolves.toBe(42) // a fila não travou
    expect(order).toEqual(['fail-start', 'next-start'])
  })

  it('3. propaga o valor de retorno ao caller', async () => {
    await expect(withSyncLock(async () => 'ok')).resolves.toBe('ok')
  })
})
