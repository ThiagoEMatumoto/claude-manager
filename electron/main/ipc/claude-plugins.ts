import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { runClaude, runClaudeJson } from '../services/claude-cli'
import type {
  AvailablePlugin,
  ManagedPluginInfo,
  PluginActionResult,
  PluginDetails,
} from '../../../shared/types/ipc'

const KNOWN_MARKETPLACES = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Mapa marketplace -> owner/repo (o "quem mantém"). Tolerante a ausência.
async function readMaintainers(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(KNOWN_MARKETPLACES, 'utf8')
    const data = JSON.parse(raw)
    if (!isRecord(data)) return {}
    const out: Record<string, string> = {}
    for (const [key, val] of Object.entries(data)) {
      if (isRecord(val) && isRecord(val.source) && typeof val.source.repo === 'string') {
        out[key] = val.source.repo
      }
    }
    return out
  } catch {
    return {}
  }
}

function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@')
  if (at === -1) return { name: id, marketplace: '' }
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) }
}

interface RawInstalled {
  id?: unknown
  version?: unknown
  scope?: unknown
  enabled?: unknown
  installedAt?: unknown
}

function mapInstalled(item: RawInstalled, maintainers: Record<string, string>): ManagedPluginInfo {
  const id = typeof item.id === 'string' ? item.id : ''
  const { name, marketplace } = splitId(id)
  return {
    id,
    name,
    marketplace,
    version: typeof item.version === 'string' ? item.version : 'unknown',
    scope: typeof item.scope === 'string' ? item.scope : 'user',
    enabled: item.enabled === true,
    installedAt: typeof item.installedAt === 'string' ? item.installedAt : null,
    maintainer: maintainers[marketplace] ?? null,
  }
}

async function listInstalled(): Promise<ManagedPluginInfo[]> {
  const [{ data }, maintainers] = await Promise.all([
    runClaudeJson<RawInstalled[]>(['plugin', 'list', '--json'], { timeoutMs: 20_000 }),
    readMaintainers(),
  ])
  if (!Array.isArray(data)) return []
  return data.map((item) => mapInstalled(item, maintainers))
}

// `--available` retorna um objeto { installed: [...], available: [...] } onde cada
// item disponível usa `pluginId`, `name`, `description`, `marketplaceName`.
interface AvailableEnvelope {
  installed?: RawInstalled[]
  available?: Array<{
    pluginId?: unknown
    name?: unknown
    description?: unknown
    marketplaceName?: unknown
  }>
}

async function listAvailable(): Promise<AvailablePlugin[]> {
  const [{ data }, maintainers] = await Promise.all([
    runClaudeJson<AvailableEnvelope>(['plugin', 'list', '--json', '--available'], {
      timeoutMs: 30_000,
    }),
    readMaintainers(),
  ])
  if (!isRecord(data)) return []

  const installedIds = new Set<string>()
  if (Array.isArray(data.installed)) {
    for (const it of data.installed) {
      if (typeof it.id === 'string') installedIds.add(it.id)
    }
  }

  const avail = Array.isArray(data.available) ? data.available : []
  const out: AvailablePlugin[] = []
  for (const item of avail) {
    const id = typeof item.pluginId === 'string' ? item.pluginId : ''
    if (!id || installedIds.has(id)) continue
    const { name, marketplace } = splitId(id)
    out.push({
      id,
      name: typeof item.name === 'string' ? item.name : name,
      marketplace,
      maintainer: maintainers[marketplace] ?? null,
      description: typeof item.description === 'string' ? item.description : undefined,
    })
  }
  return out
}

// Parse do texto do `plugin details`. Layout:
//   <nome> <versão>
//     <descrição>
//     Source: <id>
//   Component inventory
//     Skills (N)  ...
//     Agents (N)
//     ...
//   Projected token cost
//     Always-on:   ~N tok ...
function parseDetails(stdout: string, fallbackName: string): PluginDetails {
  const lines = stdout.split(/\r?\n/)
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)

  const name = nonEmpty[0]?.split(/\s+/)[0] || fallbackName
  // A descrição é a primeira linha após o título que não seja "Source:" nem cabeçalho.
  let description = ''
  for (let i = 1; i < nonEmpty.length; i++) {
    const l = nonEmpty[i]
    if (l.startsWith('Source:') || l === 'Component inventory') break
    description = l
    break
  }

  const sourceMatch = stdout.match(/^\s*Source:\s*(.+)$/m)
  const source = sourceMatch ? sourceMatch[1].trim() : ''

  const count = (label: string): number => {
    const m = stdout.match(new RegExp(`${label}\\s*\\((\\d+)\\)`))
    return m ? Number.parseInt(m[1], 10) : 0
  }

  const tokMatch = stdout.match(/Always-on:\s*~?([\d,]+)\s*tok/i)
  const alwaysOnTokens = tokMatch ? Number.parseInt(tokMatch[1].replace(/,/g, ''), 10) : undefined

  const details: PluginDetails = {
    name,
    description,
    source,
    components: {
      skills: count('Skills'),
      agents: count('Agents'),
      hooks: count('Hooks'),
      mcpServers: count('MCP servers'),
      lspServers: count('LSP servers'),
    },
    alwaysOnTokens,
  }

  // Heurística de parse falho: nenhum sinal estrutural reconhecido.
  if (!source && !stdout.includes('Component inventory')) {
    details.raw = stdout
  }
  return details
}

const actionSchema = z.object({
  action: z.enum(['enable', 'disable', 'uninstall', 'update', 'install']),
  name: z.string().min(1),
})

const detailsSchema = z.object({ name: z.string().min(1) })

function mentionsRestart(...texts: string[]): boolean {
  return texts.some((t) => /restart/i.test(t))
}

export function registerClaudePluginsIpc(): void {
  ipcMain.handle('cc:plugins:list', async (): Promise<ManagedPluginInfo[]> => {
    return listInstalled()
  })

  ipcMain.handle('cc:plugins:available', async (): Promise<AvailablePlugin[]> => {
    try {
      return await listAvailable()
    } catch {
      return []
    }
  })

  ipcMain.handle('cc:plugins:details', async (_e, payload: unknown): Promise<PluginDetails> => {
    const { name } = detailsSchema.parse(payload)
    const result = await runClaude(['plugin', 'details', name], { timeoutMs: 20_000 })
    if (result.code !== 0) {
      return {
        name,
        description: result.stderr.trim() || 'Falha ao obter detalhes do plugin.',
        source: '',
        components: { skills: 0, agents: 0, hooks: 0, mcpServers: 0, lspServers: 0 },
        raw: result.stderr || result.stdout,
      }
    }
    return parseDetails(result.stdout, name)
  })

  ipcMain.handle('cc:plugins:action', async (_e, payload: unknown): Promise<PluginActionResult> => {
    const { action, name } = actionSchema.parse(payload)
    const result = await runClaude(['plugin', action, name], { timeoutMs: 120_000 })
    const message = (result.stdout.trim() || result.stderr.trim() || '').trim()
    return {
      ok: result.code === 0,
      message: message || (result.code === 0 ? 'OK' : `Falha (code ${result.code})`),
      restartRequired: mentionsRestart(result.stdout, result.stderr),
    }
  })
}
