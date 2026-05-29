import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentInfo,
  McpInfo,
  PluginInfo,
  SkillInfo,
} from '../../../shared/types/ipc'

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

export async function readAgents(): Promise<AgentInfo[]> {
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
        })
      } catch {
        agents.push({ name: entry.name.replace(/\.md$/, ''), description: '' })
      }
    }
    agents.sort((a, b) => a.name.localeCompare(b.name))
    return agents
  } catch {
    return []
  }
}

export async function readSkills(): Promise<SkillInfo[]> {
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
      skills.push({ name, description })
    }
    skills.sort((a, b) => a.name.localeCompare(b.name))
    return skills
  } catch {
    return []
  }
}

export async function readMcps(): Promise<McpInfo[]> {
  try {
    const path = join(CLAUDE_DIR, '.mcp.json')
    const data = await readJson(path)
    if (!isRecord(data)) return []
    // Suporta `{ mcpServers: {...} }` e também um map direto de servers.
    const servers = isRecord(data.mcpServers) ? data.mcpServers : data
    const mcps: McpInfo[] = []
    for (const [name, raw] of Object.entries(servers)) {
      if (name === 'mcpServers') continue
      let kind = 'unknown'
      if (isRecord(raw)) {
        if (typeof raw.type === 'string') kind = raw.type
        else if (typeof raw.url === 'string') kind = 'http'
        else if (typeof raw.command === 'string') kind = `stdio: ${raw.command}`
      }
      mcps.push({ name, kind })
    }
    mcps.sort((a, b) => a.name.localeCompare(b.name))
    return mcps
  } catch {
    return []
  }
}
