import { describe, it, expect } from 'vitest'
import { withFileLock } from './file-lock'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('withFileLock', () => {
  it('serializa fns do mesmo path na ordem de chegada', async () => {
    const order: number[] = []
    await Promise.all([
      withFileLock('/a', async () => {
        await sleep(20)
        order.push(1)
      }),
      withFileLock('/a', async () => {
        order.push(2)
      }),
    ])
    expect(order).toEqual([1, 2])
  })

  it('paths diferentes não se bloqueiam', async () => {
    const order: string[] = []
    await Promise.all([
      withFileLock('/a', async () => {
        await sleep(20)
        order.push('a')
      }),
      withFileLock('/b', async () => {
        order.push('b')
      }),
    ])
    expect(order).toEqual(['b', 'a'])
  })

  it('erro de um caller não trava a fila nem vaza pro próximo', async () => {
    await expect(
      withFileLock('/a', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(withFileLock('/a', async () => 'ok')).resolves.toBe('ok')
  })

  it('propaga o valor de retorno do fn', async () => {
    await expect(withFileLock('/a', async () => 42)).resolves.toBe(42)
  })
})
