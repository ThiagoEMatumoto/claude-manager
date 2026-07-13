import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { getDb } from './db'
import type { McpAddInput, McpRemoveInput, McpServerEntry } from '../../../shared/types/ipc'

// Gestão dos MCP servers do CLI claude. Listagem lê os arquivos de config
// direto (o `claude mcp list` não tem --json); mutações fazem shell-out
// validado a `claude mcp add/remove` via execFile (sem shell — sem interpolação).
// Headers/env dos servers NUNCA saem daqui: podem carregar tokens.

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const addSchema = z
  .object({
    name: z.string().regex(NAME_PATTERN, 'nome inválido'),
    transport: z.enum(['stdio', 'http', 'sse']),
    target: z
      .string()
      .min(1)
      .max(2000)
      .refine((s) => !CONTROL_CHARS.test(s), 'caracteres de controle não permitidos'),
    args: z
      .array(
        z
          .string()
          .min(1)
          .max(500)
          .refine((s) => !CONTROL_CHARS.test(s), 'caracteres de controle não permitidos'),
      )
      .max(32)
      .optional(),
    scope: z.enum(['user', 'project']),
    repoId: z.string().min(1).optional(),
  })
  .strict()

const removeSchema = z
  .object({
    name: z.string().regex(NAME_PATTERN, 'nome inválido'),
    scope: z.enum(['user', 'project']),
    repoId: z.string().min(1).optional(),
  })
  .strict()

export function validateMcpAdd(raw: unknown): McpAddInput {
  const input = addSchema.parse(raw)
  if (input.scope === 'project' && !input.repoId) {
    throw new Error('repoId é obrigatório no escopo project')
  }
  if (input.transport === 'http' || input.transport === 'sse') {
    const url = new URL(input.target) // lança se malformada
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('URL deve ser http(s)')
    }
    if (input.args && input.args.length > 0) {
      throw new Error('args só se aplica a transporte stdio')
    }
  }
  return input
}

export function validateMcpRemove(raw: unknown): McpRemoveInput {
  const input = removeSchema.parse(raw)
  if (input.scope === 'project' && !input.repoId) {
    throw new Error('repoId é obrigatório no escopo project')
  }
  return input
}

// Monta o argv de `claude mcp add`. Args do stdio vão após `--` pra nunca
// serem interpretados como flags do próprio CLI.
export function buildMcpAddArgs(input: McpAddInput): string[] {
  const args = [
    'mcp',
    'add',
    '--transport',
    input.transport,
    '--scope',
    input.scope,
    input.name,
    input.target,
  ]
  if (input.transport === 'stdio' && input.args && input.args.length > 0) {
    args.push('--', ...input.args)
  }
  return args
}

export function buildMcpRemoveArgs(input: McpRemoveInput): string[] {
  return ['mcp', 'remove', '--scope', input.scope, input.name]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Projeta um map { name: config } em entradas de listagem, extraindo transporte
// e alvo SEM headers/env.
export function parseMcpServersMap(
  raw: unknown,
  scope: 'user' | 'project',
  source: string,
  repoId?: string,
): McpServerEntry[] {
  if (!isRecord(raw)) return []
  const servers = isRecord(raw.mcpServers) ? raw.mcpServers : raw
  const out: McpServerEntry[] = []
  for (const [name, cfg] of Object.entries(servers)) {
    if (name === 'mcpServers' || !isRecord(cfg)) continue
    const transport =
      typeof cfg.type === 'string'
        ? cfg.type
        : typeof cfg.url === 'string'
          ? 'http'
          : typeof cfg.command === 'string'
            ? 'stdio'
            : 'unknown'
    const target =
      typeof cfg.url === 'string'
        ? cfg.url
        : typeof cfg.command === 'string'
          ? [cfg.command, ...(Array.isArray(cfg.args) ? cfg.args.filter((a) => typeof a === 'string') : [])].join(' ')
          : ''
    const entry: McpServerEntry = { name, scope, transport, target, source }
    if (repoId) entry.repoId = repoId
    out.push(entry)
  }
  return out
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

interface RepoRow {
  id: string
  label: string
  path: string
}

function listRepos(): RepoRow[] {
  try {
    return getDb().prepare('SELECT id, label, path FROM repos').all() as RepoRow[]
  } catch {
    return []
  }
}

// user-level: ~/.claude.json (config do claude, campo mcpServers) e
// ~/.claude/.mcp.json; project-level: <repo>/.mcp.json de cada repo do DB.
export async function listMcpServers(): Promise<McpServerEntry[]> {
  const home = homedir()
  const out: McpServerEntry[] = []

  const claudeJson = await readJson(join(home, '.claude.json'))
  if (isRecord(claudeJson) && isRecord(claudeJson.mcpServers)) {
    out.push(...parseMcpServersMap(claudeJson.mcpServers, 'user', '~/.claude.json'))
  }

  const userMcpJson = await readJson(join(home, '.claude', '.mcp.json'))
  if (userMcpJson) {
    out.push(...parseMcpServersMap(userMcpJson, 'user', '~/.claude/.mcp.json'))
  }

  for (const repo of listRepos()) {
    if (!repo.path) continue
    const projectMcp = await readJson(join(repo.path, '.mcp.json'))
    if (projectMcp) {
      out.push(...parseMcpServersMap(projectMcp, 'project', repo.label || repo.path, repo.id))
    }
  }

  out.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name))
  return out
}

// Resolve o cwd de operações project-scope pelo DB — NUNCA aceita path do
// renderer (a allowlist server-side é a fronteira de segurança).
export function resolveRepoPath(repoId: string): string {
  const row = getDb().prepare('SELECT path FROM repos WHERE id = ?').get(repoId) as
    | { path: string }
    | undefined
  if (!row?.path) throw new Error('Repo não encontrado')
  return row.path
}
