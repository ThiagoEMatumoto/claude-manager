import { describe, expect, it } from 'vitest'
import { jumpDecision } from './permission-jump'

describe('jumpDecision', () => {
  it('reaches the target when current already equals it', () => {
    expect(jumpDecision('auto', 'auto', 'default', 3)).toBe('reached')
  })

  it('steps while the target is not yet reached', () => {
    expect(jumpDecision('plan', 'auto', 'default', 1)).toBe('step')
  })

  it('stops when it cycles back to the start without finding the target', () => {
    // Voltou ao modo inicial com steps>0 → alvo inalcancavel (ex: auto/dontAsk nao habilitado).
    expect(jumpDecision('default', 'dontAsk', 'default', 4)).toBe('stop')
  })

  it('does not treat current===start as a cycle on the very first observation', () => {
    // start null nao trava o primeiro passo.
    expect(jumpDecision('default', 'auto', null, 1)).toBe('step')
  })

  it('stops once the step trap (max) is hit', () => {
    expect(jumpDecision('plan', 'auto', 'default', 8)).toBe('stop')
  })

  it('reached wins even at the max trap', () => {
    expect(jumpDecision('auto', 'auto', 'default', 8)).toBe('reached')
  })
})
