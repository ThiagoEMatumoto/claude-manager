import { describe, expect, it } from 'vitest'
import { resolveJobAllowedTools } from './spawn-flags'

// resolveJobAllowedTools: allowlist ADITIVO por kind de job. web-audit precisa das
// 10 browser tools do Playwright global (prefixo mcp__plugin_playwright_playwright__)
// pra dirigir a auditoria; critique não recebe allowlist (comportamento atual —
// Read/Grep/Glob/Bash sobrevivem sem allowlist, provado no spike Fase 0). A decisão
// vive no MAIN (fail-closed), nunca no renderer.
describe('resolveJobAllowedTools', () => {
  it('web-audit libera exatamente as 10 browser tools do Playwright', () => {
    const tools = resolveJobAllowedTools('web-audit')
    expect(tools).toHaveLength(10)
    for (const t of tools) {
      expect(t.startsWith('mcp__plugin_playwright_playwright__browser_')).toBe(true)
    }
    // as tools da skill browser-validate: nav/snapshot/screenshot/console/network/
    // evaluate/type/click/fill_form/wait_for.
    expect(tools).toContain('mcp__plugin_playwright_playwright__browser_navigate')
    expect(tools).toContain('mcp__plugin_playwright_playwright__browser_evaluate')
    expect(tools).toContain('mcp__plugin_playwright_playwright__browser_take_screenshot')
    expect(tools).toContain('mcp__plugin_playwright_playwright__browser_console_messages')
    expect(tools).toContain('mcp__plugin_playwright_playwright__browser_network_requests')
    expect(tools).toContain('mcp__plugin_playwright_playwright__browser_wait_for')
  })

  it('critique não recebe allowlist (array vazio)', () => {
    expect(resolveJobAllowedTools('critique')).toEqual([])
  })

  it('kind desconhecido é fail-closed (array vazio, sem browser tools)', () => {
    expect(resolveJobAllowedTools('bogus' as never)).toEqual([])
  })
})
