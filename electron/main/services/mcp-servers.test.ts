import { describe, it, expect } from 'vitest'
import {
  buildMcpAddArgs,
  buildMcpRemoveArgs,
  parseMcpServersMap,
  validateMcpAdd,
  validateMcpRemove,
} from './mcp-servers'

describe('validateMcpAdd', () => {
  it('aceita http válido', () => {
    const input = validateMcpAdd({
      name: 'sentry',
      transport: 'http',
      target: 'https://mcp.sentry.dev/mcp',
      scope: 'user',
    })
    expect(input.name).toBe('sentry')
  })

  it('aceita stdio com args', () => {
    const input = validateMcpAdd({
      name: 'my-server',
      transport: 'stdio',
      target: 'npx',
      args: ['my-mcp-server', '--flag'],
      scope: 'user',
    })
    expect(input.args).toEqual(['my-mcp-server', '--flag'])
  })

  it('rejeita nome fora do pattern (anti-injeção)', () => {
    expect(() =>
      validateMcpAdd({ name: 'x; rm -rf /', transport: 'http', target: 'https://a.b', scope: 'user' }),
    ).toThrow()
    expect(() =>
      validateMcpAdd({ name: '--flag', transport: 'http', target: 'https://a.b', scope: 'user' }),
    ).toThrow()
  })

  it('rejeita URL malformada ou protocolo não-http', () => {
    expect(() =>
      validateMcpAdd({ name: 'a', transport: 'http', target: 'not a url', scope: 'user' }),
    ).toThrow()
    expect(() =>
      validateMcpAdd({ name: 'a', transport: 'http', target: 'file:///etc/passwd', scope: 'user' }),
    ).toThrow()
  })

  it('rejeita args em transporte http', () => {
    expect(() =>
      validateMcpAdd({
        name: 'a',
        transport: 'http',
        target: 'https://a.b',
        args: ['x'],
        scope: 'user',
      }),
    ).toThrow()
  })

  it('scope project exige repoId', () => {
    expect(() =>
      validateMcpAdd({ name: 'a', transport: 'http', target: 'https://a.b', scope: 'project' }),
    ).toThrow()
  })

  it('rejeita caracteres de controle no target/args', () => {
    expect(() =>
      validateMcpAdd({ name: 'a', transport: 'stdio', target: 'cmd\u0000arg', scope: 'user' }),
    ).toThrow()
  })
})

describe('buildMcpAddArgs', () => {
  it('stdio: args após --', () => {
    expect(
      buildMcpAddArgs({
        name: 's',
        transport: 'stdio',
        target: 'npx',
        args: ['pkg', '--flag'],
        scope: 'user',
      }),
    ).toEqual(['mcp', 'add', '--transport', 'stdio', '--scope', 'user', 's', 'npx', '--', 'pkg', '--flag'])
  })

  it('http: sem args', () => {
    expect(
      buildMcpAddArgs({ name: 's', transport: 'http', target: 'https://a.b/mcp', scope: 'project', repoId: 'r1' }),
    ).toEqual(['mcp', 'add', '--transport', 'http', '--scope', 'project', 's', 'https://a.b/mcp'])
  })
})

describe('validateMcpRemove / buildMcpRemoveArgs', () => {
  it('monta o argv de remove', () => {
    const input = validateMcpRemove({ name: 's', scope: 'user' })
    expect(buildMcpRemoveArgs(input)).toEqual(['mcp', 'remove', '--scope', 'user', 's'])
  })

  it('scope project exige repoId', () => {
    expect(() => validateMcpRemove({ name: 's', scope: 'project' })).toThrow()
  })
})

describe('parseMcpServersMap', () => {
  it('classifica http/stdio e extrai o alvo SEM headers/env', () => {
    const entries = parseMcpServersMap(
      {
        mcpServers: {
          web: { type: 'http', url: 'https://a.b/mcp', headers: { Authorization: 'Bearer sk-1' } },
          local: { command: 'npx', args: ['pkg'], env: { TOKEN: 'sk-2' } },
        },
      },
      'user',
      '~/.claude.json',
    )
    expect(entries).toEqual([
      { name: 'web', scope: 'user', transport: 'http', target: 'https://a.b/mcp', source: '~/.claude.json' },
      { name: 'local', scope: 'user', transport: 'stdio', target: 'npx pkg', source: '~/.claude.json' },
    ])
    expect(JSON.stringify(entries)).not.toContain('sk-1')
    expect(JSON.stringify(entries)).not.toContain('sk-2')
  })

  it('map direto (sem wrapper mcpServers) também funciona', () => {
    const entries = parseMcpServersMap({ a: { url: 'https://x.y' } }, 'project', 'repo-label', 'r1')
    expect(entries).toEqual([
      { name: 'a', scope: 'project', transport: 'http', target: 'https://x.y', source: 'repo-label', repoId: 'r1' },
    ])
  })

  it('entrada malformada → lista vazia', () => {
    expect(parseMcpServersMap(null, 'user', 'x')).toEqual([])
    expect(parseMcpServersMap([1, 2], 'user', 'x')).toEqual([])
  })
})
