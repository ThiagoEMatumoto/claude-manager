/** @vitest-environment node */
// Teste de contrato: sobe o server HTTP real numa porta efêmera e fala MCP de
// verdade via o client SDK (initialize / tools/list / tools/call), incluindo um
// write que dispara o notify. Também valida as camadas de guarda (401/403/404)
// e o mcp.json (conteúdo + mode 0600).
import { readFileSync, statSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join: joinPath } = await import('node:path')
  const dir = mkdtempSync(joinPath(tmpdir(), 'mcp-server-test-'))
  return {
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }
})

import { app } from 'electron'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { closeDb, getDb } from '../db'
import { startMcpServer, type McpServerHandle } from './server'
import type { McpNotify } from './tools'

const TOKEN = 'contract-test-token-0123456789abcdef0123456789abcdef'

const notifyCalls: Array<[string, unknown]> = []
const notify: McpNotify = {
  broadcast: (channel, payload) => notifyCalls.push([channel, payload]),
  affectedObjectives: () => {},
  affectedObjectivesForFeatureLinks: () => {},
}

let handle: McpServerHandle
let configPath: string

beforeAll(async () => {
  getDb()
  configPath = join(app.getPath('userData'), 'mcp.json')
  const started = await startMcpServer({ port: 0, token: TOKEN, notify, configFilePath: configPath })
  if (!started) throw new Error('mcp server failed to start on ephemeral port')
  handle = started
})

afterAll(async () => {
  await handle.close()
  closeDb()
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

async function connectedClient(): Promise<Client> {
  const client = new Client({ name: 'contract-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  await client.connect(transport)
  return client
}

describe('mcp server — contrato', () => {
  it('escreve mcp.json com url/token/pid e mode 0600', () => {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      url: string
      token: string
      pid: number
    }
    expect(parsed.url).toBe(handle.url)
    expect(parsed.token).toBe(TOKEN)
    expect(parsed.pid).toBe(process.pid)
    expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it('escreve mcp-client-config.json no formato mcpServers (--mcp-config) com mode 0600', () => {
    const clientConfigPath = join(app.getPath('userData'), 'mcp-client-config.json')
    const parsed = JSON.parse(readFileSync(clientConfigPath, 'utf8')) as {
      mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>
    }
    const server = parsed.mcpServers['claude-manager']
    expect(server.type).toBe('http')
    expect(server.url).toBe(handle.url)
    expect(server.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(statSync(clientConfigPath).mode & 0o777).toBe(0o600)
  })

  it('initialize anuncia as instructions de auto-tracking', async () => {
    const client = await connectedClient()
    try {
      const instructions = client.getInstructions()
      expect(instructions).toBeTruthy()
      expect(instructions).toContain('auto')
      expect(instructions).toContain('task_list')
    } finally {
      await client.close()
    }
  })

  it('initialize + tools/list expõe as tools de objectives/KRs', async () => {
    const client = await connectedClient()
    try {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      for (const expected of [
        'objective_list',
        'objective_get',
        'objective_create',
        'objective_update',
        'objective_archive',
        'key_result_create',
        'key_result_update',
      ]) {
        expect(names).toContain(expected)
      }
    } finally {
      await client.close()
    }
  })

  it('tools/call de write cria no DB e dispara o notify', async () => {
    const client = await connectedClient()
    try {
      notifyCalls.length = 0
      const result = await client.callTool({
        name: 'objective_create',
        arguments: { title: 'Criado via MCP', kind: 'okr' },
      })
      expect(result.isError ?? false).toBe(false)
      const structured = result.structuredContent as { objective: { id: string; title: string } }
      expect(structured.objective.title).toBe('Criado via MCP')

      const row = getDb()
        .prepare('SELECT title FROM objectives WHERE id = ?')
        .get(structured.objective.id) as { title: string }
      expect(row.title).toBe('Criado via MCP')

      expect(notifyCalls.length).toBe(1)
      expect(notifyCalls[0][0]).toBe('objective:updated')
    } finally {
      await client.close()
    }
  })

  it('rejeita request sem bearer token (401)', async () => {
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejeita Host não-local (403) e path desconhecido (404)', async () => {
    const statusFor = (path: string, host: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port: handle.port, path, method: 'POST', headers: { Host: host } },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          },
        )
        req.on('error', reject)
        req.end()
      })
    expect(await statusFor('/mcp', 'evil.example.com')).toBe(403)
    expect(await statusFor('/outra-rota', '127.0.0.1')).toBe(404)
  })
})
