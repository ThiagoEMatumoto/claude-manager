import { chmod, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { backupOnce, writeFileAtomic } from './atomic-file'
import { readClaudeSettings } from './claude-settings'
import type { StatuslineScriptFile } from '../../../shared/types/ipc'

// Editor do script apontado por statusLine.command do ~/.claude/settings.json.
// Só arquivos DENTRO do HOME — o command pode apontar pra qualquer binário do
// sistema, e não é papel do app editar /usr/bin. Fora do HOME: negado com aviso.

const MAX_SCRIPT_BYTES = 1024 * 1024 // 1MB

export type ScriptPathResolution = { ok: true; path: string } | { ok: false; reason: string }

export function resolveStatuslineScriptPath(
  command: string | null,
  home: string,
): ScriptPathResolution {
  if (!command || command.trim() === '') {
    return { ok: false, reason: 'statusLine não configurado no settings.json' }
  }
  // Primeiro token = o script; args são ignorados. Path com espaço não é
  // suportado pelo editor (edite direto no disco nesse caso).
  const token = command.trim().split(/\s+/)[0]
  const expanded = token === '~' || token.startsWith('~/') ? join(home, token.slice(1)) : token
  if (!isAbsolute(expanded)) {
    return { ok: false, reason: 'command não é um path absoluto (nem ~/): edição indisponível' }
  }
  const abs = resolve(expanded)
  if (abs !== home && !abs.startsWith(home + sep)) {
    return { ok: false, reason: 'script fora do HOME — edição negada' }
  }
  return { ok: true, path: abs }
}

// Re-resolve a partir do arquivo a cada operação — o renderer nunca manda path.
async function currentScriptPath(): Promise<ScriptPathResolution> {
  const view = await readClaudeSettings()
  return resolveStatuslineScriptPath(view.statusLineCommand, homedir())
}

export async function readStatuslineScript(): Promise<StatuslineScriptFile> {
  const res = await currentScriptPath()
  if (!res.ok) return { ok: false, message: res.reason }
  try {
    const content = await readFile(res.path, 'utf8')
    return { ok: true, path: res.path, content }
  } catch {
    return { ok: false, path: res.path, message: `Arquivo não legível: ${res.path}` }
  }
}

export async function writeStatuslineScript(content: string): Promise<string> {
  if (content.length > MAX_SCRIPT_BYTES) throw new Error('Script muito grande (máx. 1MB)')
  const res = await currentScriptPath()
  if (!res.ok) throw new Error(res.reason)
  // writeFileAtomic troca o inode (tmp + rename) — preserva o modo original
  // pra não derrubar o bit de execução do script. Só edita arquivo existente.
  let mode: number
  try {
    mode = (await stat(res.path)).mode
  } catch {
    throw new Error(`Arquivo não encontrado: ${res.path}`)
  }
  await backupOnce(res.path)
  await writeFileAtomic(res.path, content)
  await chmod(res.path, mode)
  return res.path
}
