import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComponentRef, PluginComponents } from '../../../shared/types/ipc'

// Lê os COMPONENTES de um plugin a partir do seu installPath (cache do claude).
// Tudo é tolerante a ausência/corrupção: cada fonte degrada para lista vazia.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

// Parse de frontmatter YAML simples (entre as duas primeiras linhas `---`):
// `chave: valor` linha a linha, sem lib externa.
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

// skills/<sub>/SKILL.md → ComponentRef por subdir (name/description do frontmatter).
async function readSkillsDir(dir: string): Promise<ComponentRef[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const out: ComponentRef[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      let name = entry.name
      let description: string | undefined
      try {
        const fm = parseFrontmatter(await readFile(join(dir, entry.name, 'SKILL.md'), 'utf8'))
        if (fm.name) name = fm.name
        if (fm.description) description = fm.description
      } catch {
        // sem SKILL.md legível: usa o nome do diretório
      }
      out.push({ name, description })
    }
    return out
  } catch {
    return []
  }
}

// agents/ e commands/ → ComponentRef por arquivo .md (name/description do frontmatter).
async function readMdDir(dir: string): Promise<ComponentRef[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const out: ComponentRef[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      let name = entry.name.replace(/\.md$/, '')
      let description: string | undefined
      try {
        const fm = parseFrontmatter(await readFile(join(dir, entry.name), 'utf8'))
        if (fm.name) name = fm.name
        if (fm.description) description = fm.description
      } catch {
        // mantém o nome do arquivo
      }
      out.push({ name, description })
    }
    return out
  } catch {
    return []
  }
}

// hooks/hooks.json → { hooks: { <Event>: [...] } }. Um ComponentRef por evento.
async function readHooks(installPath: string): Promise<ComponentRef[]> {
  const data =
    (await readJson(join(installPath, 'hooks', 'hooks.json'))) ??
    (await readJson(join(installPath, 'hooks.json')))
  if (!isRecord(data) || !isRecord(data.hooks)) return []
  return Object.keys(data.hooks).map((event) => ({ name: event }))
}

// .mcp.json → { mcpServers: {...} }. Um ComponentRef por server.
async function readMcps(installPath: string): Promise<ComponentRef[]> {
  const data = await readJson(join(installPath, '.mcp.json'))
  if (!isRecord(data)) return []
  const servers = isRecord(data.mcpServers) ? data.mcpServers : data
  return Object.keys(servers)
    .filter((k) => k !== 'mcpServers')
    .map((name) => ({ name }))
}

export async function readPluginComponents(installPath: string): Promise<PluginComponents> {
  if (!installPath) {
    return { skills: [], agents: [], commands: [], hooks: [], mcps: [] }
  }
  const [skills, agents, commands, hooks, mcps] = await Promise.all([
    readSkillsDir(join(installPath, 'skills')),
    readMdDir(join(installPath, 'agents')),
    readMdDir(join(installPath, 'commands')),
    readHooks(installPath),
    readMcps(installPath),
  ])
  const sortByName = (a: ComponentRef, b: ComponentRef) => a.name.localeCompare(b.name)
  return {
    skills: skills.sort(sortByName),
    agents: agents.sort(sortByName),
    commands: commands.sort(sortByName),
    hooks: hooks.sort(sortByName),
    mcps: mcps.sort(sortByName),
  }
}
