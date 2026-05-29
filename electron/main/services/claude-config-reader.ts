import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentInfo,
  HookInfo,
  McpInfo,
  PluginInfo,
  SkillInfo,
} from '../../../shared/types/ipc'
import { readPluginComponents } from './plugin-components'

// Tudo aqui é read-only e tolerante a ausência/corrupção: cada fonte é isolada
// por try/catch e degrada para lista vazia. O app pode rodar na máquina de outro
// usuário que não tem alguns desses arquivos.

const CLAUDE_DIR = join(homedir(), '.claude')

async function readJson(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function readPlugins(): Promise<PluginInfo[]> {
  try {
    const installed = await readJson(join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'))
    const settings = await readJson(join(CLAUDE_DIR, 'settings.json'))

    const enabledMap: Record<string, boolean> = {}
    if (isRecord(settings) && isRecord(settings.enabledPlugins)) {
      for (const [key, val] of Object.entries(settings.enabledPlugins)) {
        enabledMap[key] = val === true
      }
    }

    // União das chaves de installed_plugins.plugins e de enabledPlugins, para
    // mostrar tanto instalados quanto habilitados-mas-sem-cache.
    const keys = new Set<string>()
    if (isRecord(installed) && isRecord(installed.plugins)) {
      for (const k of Object.keys(installed.plugins)) keys.add(k)
    }
    for (const k of Object.keys(enabledMap)) keys.add(k)

    const plugins: PluginInfo[] = []
    for (const key of keys) {
      const [name, marketplace] = key.split('@')
      plugins.push({
        name: name ?? key,
        marketplace: marketplace ?? '',
        enabled: enabledMap[key] === true,
      })
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name))
    return plugins
  } catch {
    return []
  }
}

interface InstalledPlugin {
  id: string
  installPath: string
}

// Lê installed_plugins.json e devolve pluginId + installPath de cada instalação.
// Cada chave é `name@marketplace` mapeada para um array de instalações (por escopo);
// usamos a primeira com installPath válido. Tolerante a ausência/corrupção.
async function readInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const data = await readJson(join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'))
    if (!isRecord(data)) return []
    const plugins = isRecord(data.plugins) ? data.plugins : data
    const out: InstalledPlugin[] = []
    for (const [id, raw] of Object.entries(plugins)) {
      if (id === 'plugins') continue
      const installs = Array.isArray(raw) ? raw : [raw]
      for (const inst of installs) {
        if (isRecord(inst) && typeof inst.installPath === 'string' && inst.installPath) {
          out.push({ id, installPath: inst.installPath })
          break
        }
      }
    }
    return out
  } catch {
    return []
  }
}

// Extrai campos de um bloco de frontmatter YAML simples (entre as primeiras duas
// linhas `---`). Sem lib YAML: parse linha-a-linha de `chave: valor`.
function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const fields: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') break
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (match) {
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      fields[match[1]] = value
    }
  }
  return fields
}

async function readUserAgents(): Promise<AgentInfo[]> {
  try {
    const dir = join(CLAUDE_DIR, 'agents')
    const entries = await readdir(dir, { withFileTypes: true })
    const agents: AgentInfo[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      try {
        const content = await readFile(join(dir, entry.name), 'utf8')
        const fm = parseFrontmatter(content)
        agents.push({
          name: fm.name || entry.name.replace(/\.md$/, ''),
          description: fm.description || '',
          origin: 'user',
        })
      } catch {
        agents.push({ name: entry.name.replace(/\.md$/, ''), description: '', origin: 'user' })
      }
    }
    return agents
  } catch {
    return []
  }
}

// Agrega agents user-level + de cada plugin instalado (origin = pluginId).
export async function readAgents(): Promise<AgentInfo[]> {
  const installed = await readInstalledPlugins()
  const fromPlugins = await Promise.all(
    installed.map(async ({ id, installPath }) => {
      const { agents } = await readPluginComponents(installPath)
      return agents.map<AgentInfo>((a) => ({
        name: a.name,
        description: a.description ?? '',
        origin: id,
      }))
    }),
  )
  const agents = [...(await readUserAgents()), ...fromPlugins.flat()]
  agents.sort((a, b) => a.name.localeCompare(b.name))
  return agents
}

async function readUserSkills(): Promise<SkillInfo[]> {
  try {
    const dir = join(CLAUDE_DIR, 'skills')
    const entries = await readdir(dir, { withFileTypes: true })
    const skills: SkillInfo[] = []
    for (const entry of entries) {
      let name = entry.name
      let description = ''
      if (entry.isDirectory()) {
        const skillMd = join(dir, entry.name, 'SKILL.md')
        try {
          const content = await readFile(skillMd, 'utf8')
          const fm = parseFrontmatter(content)
          if (fm.name) name = fm.name
          description = fm.description || ''
        } catch {
          // Dir sem SKILL.md legível: mantém o nome do diretório.
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        name = entry.name.replace(/\.md$/, '')
        try {
          const content = await readFile(join(dir, entry.name), 'utf8')
          const fm = parseFrontmatter(content)
          if (fm.name) name = fm.name
          description = fm.description || ''
        } catch {
          // ignora
        }
      } else {
        continue
      }
      skills.push({ name, description, origin: 'user' })
    }
    return skills
  } catch {
    return []
  }
}

// Agrega skills user-level + de cada plugin instalado (origin = pluginId).
export async function readSkills(): Promise<SkillInfo[]> {
  const installed = await readInstalledPlugins()
  const fromPlugins = await Promise.all(
    installed.map(async ({ id, installPath }) => {
      const { skills } = await readPluginComponents(installPath)
      return skills.map<SkillInfo>((s) => ({
        name: s.name,
        description: s.description ?? '',
        origin: id,
      }))
    }),
  )
  const skills = [...(await readUserSkills()), ...fromPlugins.flat()]
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

function classifyMcpKind(raw: unknown): string {
  if (isRecord(raw)) {
    if (typeof raw.type === 'string') return raw.type
    if (typeof raw.url === 'string') return 'http'
    if (typeof raw.command === 'string') return `stdio: ${raw.command}`
  }
  return 'unknown'
}

async function readUserMcps(): Promise<McpInfo[]> {
  try {
    const data = await readJson(join(CLAUDE_DIR, '.mcp.json'))
    if (!isRecord(data)) return []
    // Suporta `{ mcpServers: {...} }` e também um map direto de servers.
    const servers = isRecord(data.mcpServers) ? data.mcpServers : data
    const mcps: McpInfo[] = []
    for (const [name, raw] of Object.entries(servers)) {
      if (name === 'mcpServers') continue
      mcps.push({ name, kind: classifyMcpKind(raw), origin: 'user' })
    }
    return mcps
  } catch {
    return []
  }
}

// Lê os mcpServers do .mcp.json de um plugin, com kind classificado.
async function readPluginMcpsDetailed(installPath: string, origin: string): Promise<McpInfo[]> {
  try {
    const data = await readJson(join(installPath, '.mcp.json'))
    if (!isRecord(data)) return []
    const servers = isRecord(data.mcpServers) ? data.mcpServers : data
    const mcps: McpInfo[] = []
    for (const [name, raw] of Object.entries(servers)) {
      if (name === 'mcpServers') continue
      mcps.push({ name, kind: classifyMcpKind(raw), origin })
    }
    return mcps
  } catch {
    return []
  }
}

// Agrega mcps user-level + de cada plugin instalado (origin = pluginId).
export async function readMcps(): Promise<McpInfo[]> {
  const installed = await readInstalledPlugins()
  const fromPlugins = await Promise.all(
    installed.map(({ id, installPath }) => readPluginMcpsDetailed(installPath, id)),
  )
  const mcps = [...(await readUserMcps()), ...fromPlugins.flat()]
  mcps.sort((a, b) => a.name.localeCompare(b.name))
  return mcps
}

// Hooks user-level: settings.json.hooks (eventos) + scripts em ~/.claude/hooks/.
async function readUserHooks(): Promise<HookInfo[]> {
  const out: HookInfo[] = []
  try {
    const settings = await readJson(join(CLAUDE_DIR, 'settings.json'))
    if (isRecord(settings) && isRecord(settings.hooks)) {
      for (const [event, defs] of Object.entries(settings.hooks)) {
        const count = Array.isArray(defs) ? defs.length : 0
        out.push({
          event,
          origin: 'user',
          summary: count ? `${count} matcher${count === 1 ? '' : 's'}` : 'configured',
        })
      }
    }
  } catch {
    // sem settings.json legível
  }
  try {
    const dir = join(CLAUDE_DIR, 'hooks')
    const entries = await readdir(dir, { withFileTypes: true })
    const scripts = entries.filter((e) => e.isFile()).map((e) => e.name)
    if (scripts.length) {
      out.push({
        event: 'scripts',
        origin: 'user',
        summary: `${scripts.length} script${scripts.length === 1 ? '' : 's'} em ~/.claude/hooks`,
      })
    }
  } catch {
    // sem dir de hooks
  }
  return out
}

// Agrega hooks user-level + de cada plugin instalado (origin = pluginId, por evento).
export async function readHooks(): Promise<HookInfo[]> {
  const installed = await readInstalledPlugins()
  const fromPlugins = await Promise.all(
    installed.map(async ({ id, installPath }) => {
      const { hooks } = await readPluginComponents(installPath)
      return hooks.map<HookInfo>((h) => ({ event: h.name, origin: id, summary: 'plugin hook' }))
    }),
  )
  const hooks = [...(await readUserHooks()), ...fromPlugins.flat()]
  hooks.sort((a, b) => a.event.localeCompare(b.event) || a.origin.localeCompare(b.origin))
  return hooks
}
