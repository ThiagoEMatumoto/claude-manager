// Configuração do MCP server embutido: porta (app_prefs) e bearer token
// (gerado uma vez, persistido em <userData>/mcp.json com mode 0600).
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db'

export const DEFAULT_MCP_PORT = 41956
export const MCP_PORT_PREF_KEY = 'mcp_port'

export function getMcpPort(): number {
  const row = getDb()
    .prepare('SELECT value FROM app_prefs WHERE key = ?')
    .get(MCP_PORT_PREF_KEY) as { value: string } | undefined
  if (!row) return DEFAULT_MCP_PORT
  try {
    const value: unknown = JSON.parse(row.value)
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536) {
      return value
    }
  } catch {
    // valor corrompido → default
  }
  return DEFAULT_MCP_PORT
}

// Arquivo de descoberta consumido por sessões externas (claude mcp add) e pela
// injeção no spawn (B4). O token é a credencial — daí o mode 0600.
export interface McpRuntimeInfo {
  url: string
  token: string
  pid: number
}

export function mcpConfigPath(): string {
  return join(app.getPath('userData'), 'mcp.json')
}

// Token gerado uma vez e reutilizado entre boots: se o mcp.json anterior tem um
// token válido, mantém (configs externas já apontam pra ele); senão gera novo.
export function loadOrCreateToken(path: string = mcpConfigPath()): string {
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<McpRuntimeInfo>
      if (typeof parsed.token === 'string' && parsed.token.length >= 32) return parsed.token
    } catch {
      // arquivo corrompido → regenera
    }
  }
  return randomBytes(32).toString('hex')
}

export function writeMcpRuntimeInfo(info: McpRuntimeInfo, path: string = mcpConfigPath()): void {
  writeFileSync(path, JSON.stringify(info, null, 2) + '\n', { mode: 0o600 })
  // O mode do writeFileSync só vale na criação; se o arquivo já existia com
  // outra permissão, força 0600.
  chmodSync(path, 0o600)
}

// Config no formato consumido pelo `claude --mcp-config`: mesmo shape do
// .mcp.json de projetos (mcpServers → nome → {type, url, headers}). Regenerado
// a cada boot junto com o mcp.json — URL/token sempre atuais. Contém o token,
// daí o mesmo mode 0600.
export function mcpClientConfigPath(): string {
  return join(app.getPath('userData'), 'mcp-client-config.json')
}

export function writeMcpClientConfig(
  info: McpRuntimeInfo,
  path: string = mcpClientConfigPath(),
): void {
  const config = {
    mcpServers: {
      'claude-manager': {
        type: 'http',
        url: info.url,
        headers: { Authorization: `Bearer ${info.token}` },
      },
    },
  }
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  chmodSync(path, 0o600)
}
