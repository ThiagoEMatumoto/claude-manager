import { ipcMain } from 'electron'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { backupOnce, writeFileAtomic } from '../services/atomic-file'
import { readClaudeSettings, writeClaudeSettings } from '../services/claude-settings'
import type {
  ClaudeCliSettings,
  ClaudeMdFile,
  ClaudeWriteResult,
  RuleFileEntry,
} from '../../../shared/types/ipc'

// Superfícies de configuração do CLI claude em ~/.claude: settings.json
// (validado por chave), CLAUDE.md (editor) e rules/ (read-only). O renderer
// nunca toca fs direto — tudo passa por aqui com paths fixados no main.

const CLAUDE_DIR = path.join(homedir(), '.claude')
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md')
const RULES_DIR = path.join(CLAUDE_DIR, 'rules')

const MAX_CLAUDE_MD_BYTES = 1024 * 1024 // 1MB

const writeMdSchema = z.object({ content: z.string().max(MAX_CLAUDE_MD_BYTES) })
const readRuleSchema = z.object({ relPath: z.string().min(1).max(512) })

async function readTextFile(filePath: string): Promise<ClaudeMdFile> {
  try {
    const content = await readFile(filePath, 'utf8')
    return { exists: true, content }
  } catch {
    return { exists: false, content: '' }
  }
}

// Varre rules/ recursivamente por .md. Profundidade limitada pra não passear
// por symlinks/estruturas patológicas.
async function listRuleFiles(dir: string, rel: string, depth: number): Promise<RuleFileEntry[]> {
  if (depth > 4) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: RuleFileEntry[] = []
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await listRuleFiles(path.join(dir, entry.name), relPath, depth + 1)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push({ name: entry.name, relPath })
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

// Fronteira de segurança: o relPath vem do renderer — resolve e garante que o
// alvo continua DENTRO de rules/ (barra traversal com ..) e é .md.
function resolveRulePath(relPath: string): string {
  if (!relPath.endsWith('.md')) throw new Error('Apenas arquivos .md')
  const abs = path.resolve(RULES_DIR, relPath)
  if (abs !== RULES_DIR && !abs.startsWith(RULES_DIR + path.sep)) {
    throw new Error('Path fora de ~/.claude/rules')
  }
  return abs
}

export function registerClaudeSettingsIpc(): void {
  ipcMain.handle('cc:settings:read', async (): Promise<ClaudeCliSettings> => {
    return readClaudeSettings()
  })

  ipcMain.handle('cc:settings:write', async (_e, payload: unknown): Promise<ClaudeWriteResult> => {
    try {
      await writeClaudeSettings(payload)
      return { ok: true, message: 'Salvo em ~/.claude/settings.json' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('cc:claude-md:read', async (): Promise<ClaudeMdFile> => {
    return readTextFile(CLAUDE_MD_PATH)
  })

  ipcMain.handle('cc:claude-md:write', async (_e, payload: unknown): Promise<ClaudeWriteResult> => {
    try {
      const { content } = writeMdSchema.parse(payload)
      await backupOnce(CLAUDE_MD_PATH)
      await writeFileAtomic(CLAUDE_MD_PATH, content)
      return { ok: true, message: 'Salvo em ~/.claude/CLAUDE.md' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('cc:rules:list', async (): Promise<RuleFileEntry[]> => {
    return listRuleFiles(RULES_DIR, '', 0)
  })

  ipcMain.handle('cc:rules:read', async (_e, payload: unknown): Promise<ClaudeMdFile> => {
    const { relPath } = readRuleSchema.parse(payload)
    return readTextFile(resolveRulePath(relPath))
  })
}
