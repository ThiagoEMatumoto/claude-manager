/** @vitest-environment node */
// Unit dos pedaços puros do config MCP: resolvedor de porta (env > pref >
// default, '0' = efêmera) e decisão/execução do cleanup de configs stale no
// caminho de EADDRINUSE — tudo sem subir server nem electron real.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { mkdtempSync: mkTmp } = await import('node:fs')
  const { tmpdir: osTmp } = await import('node:os')
  const { join: joinPath } = await import('node:path')
  const dir = mkTmp(joinPath(osTmp(), 'mcp-config-test-'))
  return {
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import {
  DEFAULT_MCP_PORT,
  cleanupStaleMcpConfigs,
  decideStaleConfigCleanup,
  parseMcpPortEnv,
  resolveMcpPort,
} from './config'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-stale-test-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

describe('parseMcpPortEnv', () => {
  it('aceita porta válida e 0 (efêmera)', () => {
    expect(parseMcpPortEnv('41957')).toBe(41957)
    expect(parseMcpPortEnv('0')).toBe(0)
    expect(parseMcpPortEnv(' 8080 ')).toBe(8080)
  })

  it('rejeita ausente, vazio, não-numérico e fora de range', () => {
    expect(parseMcpPortEnv(undefined)).toBeNull()
    expect(parseMcpPortEnv('')).toBeNull()
    expect(parseMcpPortEnv('  ')).toBeNull()
    expect(parseMcpPortEnv('abc')).toBeNull()
    expect(parseMcpPortEnv('65536')).toBeNull()
    expect(parseMcpPortEnv('-1')).toBeNull()
    expect(parseMcpPortEnv('41957.5')).toBeNull()
  })
})

describe('resolveMcpPort — precedência env > pref > default', () => {
  it('env vence a pref', () => {
    expect(resolveMcpPort('5000', 6000)).toBe(5000)
  })

  it("env '0' é válido e vence a pref", () => {
    expect(resolveMcpPort('0', 6000)).toBe(0)
  })

  it('env inválido cai pra pref', () => {
    expect(resolveMcpPort('not-a-port', 6000)).toBe(6000)
  })

  it('sem env usa a pref', () => {
    expect(resolveMcpPort(undefined, 6000)).toBe(6000)
  })

  it('pref inválida (0, fora de range, não-inteira, null) cai pro default', () => {
    expect(resolveMcpPort(undefined, 0)).toBe(DEFAULT_MCP_PORT)
    expect(resolveMcpPort(undefined, 65536)).toBe(DEFAULT_MCP_PORT)
    expect(resolveMcpPort(undefined, 41957.5)).toBe(DEFAULT_MCP_PORT)
    expect(resolveMcpPort(undefined, null)).toBe(DEFAULT_MCP_PORT)
  })

  it('sem env e sem pref usa o default', () => {
    expect(resolveMcpPort(undefined, null)).toBe(DEFAULT_MCP_PORT)
  })
})

describe('decideStaleConfigCleanup', () => {
  const alive = () => true
  const dead = () => false

  it('mantém quando o pid é de OUTRO processo vivo (instância legítima)', () => {
    expect(decideStaleConfigCleanup(1234, 9999, alive)).toBe('keep')
  })

  it('deleta quando o pid é o nosso (sobra do próprio boot)', () => {
    expect(decideStaleConfigCleanup(1234, 1234, alive)).toBe('delete')
  })

  it('deleta quando o pid está morto', () => {
    expect(decideStaleConfigCleanup(1234, 9999, dead)).toBe('delete')
  })

  it('deleta quando não há pid (arquivo sem pid/corrompido/ausente)', () => {
    expect(decideStaleConfigCleanup(null, 9999, alive)).toBe('delete')
  })
})

describe('cleanupStaleMcpConfigs', () => {
  it('deleta mcp.json e mcp-client-config.json quando o pid registrado está morto', () => {
    const dir = makeTmpDir()
    const configPath = join(dir, 'mcp.json')
    const clientConfigPath = join(dir, 'mcp-client-config.json')
    // PID improvável de existir: além do range típico de pid_max em uso.
    writeFileSync(
      configPath,
      JSON.stringify({ url: 'http://127.0.0.1:1/mcp', token: 'x'.repeat(64), pid: 2 ** 30 }),
    )
    writeFileSync(clientConfigPath, JSON.stringify({ mcpServers: {} }))

    expect(cleanupStaleMcpConfigs(configPath, clientConfigPath)).toBe('delete')
    expect(existsSync(configPath)).toBe(false)
    expect(existsSync(clientConfigPath)).toBe(false)
  })

  it('deleta config stale herdado mesmo quando o mcp.json é corrompido', () => {
    const dir = makeTmpDir()
    const configPath = join(dir, 'mcp.json')
    const clientConfigPath = join(dir, 'mcp-client-config.json')
    writeFileSync(configPath, 'not json{{')
    writeFileSync(clientConfigPath, JSON.stringify({ mcpServers: {} }))

    expect(cleanupStaleMcpConfigs(configPath, clientConfigPath)).toBe('delete')
    expect(existsSync(configPath)).toBe(false)
    expect(existsSync(clientConfigPath)).toBe(false)
  })

  it('mantém os arquivos quando o pid é de outro processo vivo', () => {
    const dir = makeTmpDir()
    const configPath = join(dir, 'mcp.json')
    const clientConfigPath = join(dir, 'mcp-client-config.json')
    // PID 1 (init/systemd) está sempre vivo e nunca é o processo de teste.
    writeFileSync(
      configPath,
      JSON.stringify({ url: 'http://127.0.0.1:1/mcp', token: 'x'.repeat(64), pid: 1 }),
    )
    writeFileSync(clientConfigPath, JSON.stringify({ mcpServers: {} }))

    expect(cleanupStaleMcpConfigs(configPath, clientConfigPath)).toBe('keep')
    expect(existsSync(configPath)).toBe(true)
    expect(existsSync(clientConfigPath)).toBe(true)
  })

  it('é no-op seguro quando os arquivos não existem', () => {
    const dir = makeTmpDir()
    expect(cleanupStaleMcpConfigs(join(dir, 'mcp.json'), join(dir, 'mcp-client-config.json'))).toBe(
      'delete',
    )
  })
})
