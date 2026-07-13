import { describe, it, expect } from 'vitest'
import { resolveStatuslineScriptPath } from './statusline-script'

const HOME = '/home/user'

describe('resolveStatuslineScriptPath', () => {
  it('expande ~/ para o HOME', () => {
    expect(resolveStatuslineScriptPath('~/.claude/statusline.sh', HOME)).toEqual({
      ok: true,
      path: '/home/user/.claude/statusline.sh',
    })
  })

  it('aceita path absoluto dentro do HOME e ignora args', () => {
    expect(resolveStatuslineScriptPath('/home/user/bin/status.sh --fast -v', HOME)).toEqual({
      ok: true,
      path: '/home/user/bin/status.sh',
    })
  })

  it('nega path fora do HOME (com aviso)', () => {
    const res = resolveStatuslineScriptPath('/usr/bin/starship prompt', HOME)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/fora do HOME/)
  })

  it('nega traversal que escapa do HOME via ..', () => {
    const res = resolveStatuslineScriptPath('~/../other-user/x.sh', HOME)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/fora do HOME/)
  })

  it('nega prefixo parcial do HOME (/home/user2)', () => {
    expect(resolveStatuslineScriptPath('/home/user2/x.sh', HOME).ok).toBe(false)
  })

  it('nega comando relativo (não é path local resolvível)', () => {
    const res = resolveStatuslineScriptPath('starship prompt', HOME)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/absoluto/)
  })

  it('nega statusLine ausente', () => {
    expect(resolveStatuslineScriptPath(null, HOME).ok).toBe(false)
    expect(resolveStatuslineScriptPath('   ', HOME).ok).toBe(false)
  })
})
