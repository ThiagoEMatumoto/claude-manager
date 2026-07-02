import { ipcMain } from 'electron'
import { z } from 'zod'
import { simpleGit } from 'simple-git'
import { homedir } from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, cp, rm, symlink, lstat, unlink } from 'node:fs/promises'
import { getDb } from '../services/db'
import { backfillRepoRemotes } from '../services/git-remote'
import { validateBlankRepoName } from './blank-repo'

const VAULT_ROOT_KEY = 'vault_root'

function defaultVaultRoot(): string {
  return path.join(homedir(), 'ClaudeManager')
}

export function isInsideVault(vaultPath: string, target: string): boolean {
  const rel = path.relative(vaultPath, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const setRootSchema = z.object({ root: z.string().min(1) })
const ensureDirSchema = z.object({ path: z.string().min(1) })
const isInsideSchema = z.object({ vaultPath: z.string().min(1), target: z.string().min(1) })
const moveSchema = z.object({
  source: z.string().min(1),
  vaultPath: z.string().min(1),
  label: z.string().min(1),
})
const symlinkSchema = moveSchema
const removeSymlinkSchema = z.object({ target: z.string().min(1) })
const cloneSchema = z.object({ url: z.string().min(1), vaultPath: z.string().min(1) })
const createBlankSchema = z.object({
  vaultPath: z.string().min(1),
  name: z.string().min(1),
  gitInit: z.boolean(),
})

function repoNameFromUrl(url: string): string {
  const base = url.replace(/\/+$/, '').split('/').pop() ?? 'repo'
  return base.replace(/\.git$/, '')
}

export function registerGitIpc(): void {
  ipcMain.handle('vault:get-root', () => {
    const row = getDb()
      .prepare('SELECT value FROM app_prefs WHERE key = ?')
      .get(VAULT_ROOT_KEY) as { value: string } | undefined
    return row?.value ?? defaultVaultRoot()
  })

  ipcMain.handle('vault:is-configured', () => {
    const row = getDb()
      .prepare('SELECT value FROM app_prefs WHERE key = ?')
      .get(VAULT_ROOT_KEY) as { value: string } | undefined
    return row !== undefined
  })

  ipcMain.handle('vault:set-root', (_e, payload: unknown) => {
    const { root } = setRootSchema.parse(payload)
    getDb()
      .prepare('INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)')
      .run(VAULT_ROOT_KEY, root)
  })

  ipcMain.handle('vault:ensure-dir', async (_e, payload: unknown) => {
    const { path: dir } = ensureDirSchema.parse(payload)
    const existed = existsSync(dir)
    await mkdir(dir, { recursive: true })
    const entries = await readdir(dir)
    return { created: !existed, wasEmpty: entries.length === 0 }
  })

  ipcMain.handle('vault:is-inside', (_e, payload: unknown) => {
    const { vaultPath, target } = isInsideSchema.parse(payload)
    return isInsideVault(vaultPath, target)
  })

  ipcMain.handle('repo:move-into-vault', async (_e, payload: unknown) => {
    const { source, vaultPath, label } = moveSchema.parse(payload)
    const dest = path.join(vaultPath, label)

    // O destino pode já existir. Caso comum: um symlink órfão deixado por um
    // registro 'symlink' anterior que foi deletado. Tratamos antes do rename
    // (que falharia com EEXIST/ENOTEMPTY e seria engolido pela UI).
    const destStat = await lstat(dest).catch(() => null)
    if (destStat) {
      if (destStat.isSymbolicLink()) {
        // Artefato órfão: remove só o link (NÃO segue o alvo) e segue com o move.
        await unlink(dest)
      } else {
        throw new Error(`destino já existe: ${dest}`)
      }
    }

    try {
      await rename(source, dest)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await cp(source, dest, { recursive: true })
        await rm(source, { recursive: true, force: true })
      } else {
        throw err
      }
    }
    return { path: dest }
  })

  ipcMain.handle('repo:symlink-into-vault', async (_e, payload: unknown) => {
    const { source, vaultPath, label } = symlinkSchema.parse(payload)
    const dest = path.join(vaultPath, label)
    try {
      await symlink(source, dest)
    } catch (err) {
      throw new Error(`Falha ao criar symlink em ${dest}: ${(err as Error).message}`)
    }
    return { path: dest }
  })

  ipcMain.handle('repo:remove-symlink', async (_e, payload: unknown) => {
    const { target } = removeSymlinkSchema.parse(payload)
    const stat = await lstat(target).catch(() => null)
    if (!stat) return { removed: false }
    // Segurança: só removemos symlinks. Diretórios/arquivos reais são dados do
    // usuário e jamais devem ser apagados aqui.
    if (!stat.isSymbolicLink()) {
      throw new Error(`não é um symlink, recusando remover: ${target}`)
    }
    await unlink(target)
    return { removed: true }
  })

  ipcMain.handle('repo:clone-url', async (_e, payload: unknown) => {
    const { url, vaultPath } = cloneSchema.parse(payload)
    const dest = path.join(vaultPath, repoNameFromUrl(url))
    await simpleGit().clone(url, dest)
    // A persistência de remote_url/default_branch acontece no registro
    // (projects:repos:create), que deriva a origin do disco recém-clonado.
    // Devolvemos a URL usada só por transparência ao caller.
    return { path: dest, url }
  })

  // Idempotente: preenche remote_url/default_branch de repos ainda nulos cujo path
  // existe no disco. Exposto pra ser acionado no boot (gatilho ligado em fase
  // posterior) ou manualmente. Retorna { scanned, updated }.
  ipcMain.handle('repos:backfill-remotes', () => backfillRepoRemotes())

  ipcMain.handle('repo:create-blank', async (_e, payload: unknown) => {
    const { vaultPath, name, gitInit } = createBlankSchema.parse(payload)
    const result = validateBlankRepoName(name)
    if (!result.ok) {
      throw new Error(result.error)
    }
    // O nome validado não contém separadores → o join nunca escapa do vault.
    const dest = path.join(vaultPath, result.name)
    // lstat (e não existsSync) pra detectar também symlinks quebrados no destino.
    const destStat = await lstat(dest).catch(() => null)
    if (destStat) {
      throw new Error(`destino já existe: ${dest}`)
    }
    await mkdir(dest, { recursive: true })
    if (gitInit) {
      await simpleGit(dest).init()
    }
    return { path: dest }
  })
}
