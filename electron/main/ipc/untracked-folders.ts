import path from 'node:path'
import type { UntrackedFolder } from '../../../shared/types/ipc'

// Normaliza um path pra comparação estável (remove barra final, resolve . e ..).
export function normalizePath(p: string): string {
  return path.normalize(p).replace(/[/\\]+$/, '')
}

// Subconjunto de fs.Dirent que precisamos — mantém a função pura/testável.
export interface DirEntryLike {
  name: string
  isDirectory(): boolean
}

// Dado o conteúdo do vault e os paths já registrados, retorna as pastas de
// primeiro nível ainda não adicionadas (exclui dotfiles, arquivos e já-registradas).
export function selectUntracked(
  vaultPath: string,
  entries: DirEntryLike[],
  registeredPaths: string[],
): UntrackedFolder[] {
  const registered = new Set(registeredPaths.map(normalizePath))
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(vaultPath, e.name) }))
    .filter((f) => !registered.has(normalizePath(f.path)))
    .sort((a, b) => a.name.localeCompare(b.name))
}
