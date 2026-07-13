import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { backupOnce, writeFileAtomic } from './atomic-file'
import type { ClaudeMdFile } from '../../../shared/types/ipc'

// Editor de ~/.claude/keybindings.json (atalhos do CLI claude). Texto livre no
// renderer, mas o main valida o parse antes de gravar — um JSON malformado
// quebraria o CLI no load.

export const KEYBINDINGS_PATH = join(homedir(), '.claude', 'keybindings.json')

const MAX_KEYBINDINGS_BYTES = 256 * 1024

export function validateKeybindingsContent(content: string): void {
  if (content.length > MAX_KEYBINDINGS_BYTES) {
    throw new Error('Arquivo muito grande (máx. 256KB)')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(`JSON inválido: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('A raiz do keybindings.json deve ser um objeto')
  }
}

export async function readKeybindings(): Promise<ClaudeMdFile> {
  try {
    return { exists: true, content: await readFile(KEYBINDINGS_PATH, 'utf8') }
  } catch {
    // Arquivo inexistente: a UI mostra vazio com dica e cria ao salvar.
    return { exists: false, content: '' }
  }
}

export async function writeKeybindings(content: string): Promise<void> {
  validateKeybindingsContent(content)
  await backupOnce(KEYBINDINGS_PATH)
  await writeFileAtomic(KEYBINDINGS_PATH, content)
}
