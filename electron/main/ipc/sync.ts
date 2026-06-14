import { app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../services/db'
import { startFeatureWatcher, stopFeatureWatcher } from '../services/feature-store'
import {
  applyRemote,
  bundleDirFor,
  ensureRepo,
  ghAuthToken,
  pull,
  pushBundle,
  status as gitStatus,
  type GitSyncOpts,
} from '../services/sync/git-sync'
import { importBundle } from '../services/sync/importer'
import { readSyncConfig, updateSyncConfig } from '../services/sync/sync-config'
import type {
  SyncConfigureInput,
  SyncNowResult,
  SyncResolveConflictInput,
  SyncStatus,
} from '../../../shared/types/ipc'

// Working dir do clone (default <userData>/sync). Injetável via setSyncWorkdir
// para teste; a IPC sempre usa o default em produção.
let workdirOverride: string | null = null

export function setSyncWorkdir(dir: string | null): void {
  workdirOverride = dir
}

function workdir(): string {
  return workdirOverride ?? join(app.getPath('userData'), 'sync')
}

function authOpts(): GitSyncOpts {
  const authToken = ghAuthToken()
  return authToken ? { authToken } : {}
}

function isConfigured(): boolean {
  return existsSync(join(workdir(), '.git'))
}

// ---- status agregado (config + git + schema) ----

async function buildStatus(): Promise<SyncStatus> {
  const cfg = readSyncConfig()
  const configured = isConfigured()
  const db = getDb()
  const schemaVersion =
    (db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number | null }).v ?? 0

  let git: SyncStatus['git'] = null
  if (configured) {
    try {
      const s = await gitStatus(workdir())
      git = { dirty: s.dirty, ahead: s.ahead, behind: s.behind, lastCommit: s.lastCommit }
    } catch {
      git = null
    }
  }

  return {
    configured,
    repoUrl: cfg.repoUrl,
    machineId: cfg.machineId,
    lastPullAt: cfg.lastPullAt,
    lastPushAt: cfg.lastPushAt,
    schemaVersion,
    git,
  }
}

// ---- sync:now — pull → decidir import vs push, reportar conflito ----
//
// Conservador (mesma doutrina do boot):
//  - behind>0 e ahead==0 (fast-forward limpo) → applyRemote + importBundle.
//  - diverged (ahead>0 e behind>0)            → reporta conflito, NÃO toca dados.
//  - ahead>0 e behind==0 (ou em sync)          → export + push.
async function syncNow(): Promise<SyncNowResult> {
  if (!isConfigured()) return { state: 'not-configured' }
  const opts = authOpts()
  const st = await pull(workdir(), opts)

  if (st.diverged) {
    return { state: 'conflict', ahead: st.ahead, behind: st.behind }
  }

  if (st.behind > 0 && st.ahead === 0) {
    await applyRemote(workdir())
    importBundle(getDb(), bundleDirFor(workdir()), watcherHooks())
    updateSyncConfig({ lastPullAt: Date.now() })
    return { state: 'pulled' }
  }

  // Nada a baixar com segurança → empurra estado local.
  const res = await pushBundle(workdir(), getDb(), commitMessage(), opts)
  if (res.rejected) {
    // origin avançou entre o pull e o push → conflito.
    const after = await pull(workdir(), opts)
    return { state: 'conflict', ahead: after.ahead, behind: after.behind }
  }
  if (res.pushed) {
    updateSyncConfig({ lastPushAt: Date.now() })
    return { state: 'pushed' }
  }
  return { state: 'up-to-date' }
}

function commitMessage(): string {
  const cfg = readSyncConfig()
  return `chore(sync): bundle from ${cfg.machineId} @ ${new Date().toISOString()}`
}

// Hooks reais do watcher para o importBundle (pausa/reinicia o chokidar).
// `active` = o watcher está rodando AGORA (boot ainda não o iniciou → false,
// então o import não o reinicia prematuramente; o boot o inicia depois).
function watcherHooks(active = true) {
  return {
    stopWatcher: stopFeatureWatcher,
    startWatcher: startFeatureWatcher,
    watcherWasActive: active,
  }
}

// ---- registro IPC ----

export function registerSyncIpc(): void {
  ipcMain.handle('sync:status', (): Promise<SyncStatus> => buildStatus())

  ipcMain.handle('sync:configure', async (_e, input: SyncConfigureInput): Promise<SyncStatus> => {
    const opts = authOpts()
    await ensureRepo(workdir(), input.repoUrl, opts)
    updateSyncConfig({ repoUrl: input.repoUrl })
    return buildStatus()
  })

  ipcMain.handle('sync:now', (): Promise<SyncNowResult> => syncNow())

  // Sobrescreve o REMOTO com o estado local (push --force).
  ipcMain.handle('sync:export-force', async (): Promise<SyncNowResult> => {
    if (!isConfigured()) return { state: 'not-configured' }
    const res = await pushBundle(workdir(), getDb(), commitMessage(), { ...authOpts(), force: true })
    if (res.pushed) {
      updateSyncConfig({ lastPushAt: Date.now() })
      return { state: 'pushed' }
    }
    return { state: 'up-to-date' }
  })

  // Sobrescreve o LOCAL com o remoto (applyRemote + importBundle).
  ipcMain.handle('sync:import-force', async (): Promise<SyncNowResult> => {
    if (!isConfigured()) return { state: 'not-configured' }
    await pull(workdir(), authOpts())
    await applyRemote(workdir())
    importBundle(getDb(), bundleDirFor(workdir()), watcherHooks())
    updateSyncConfig({ lastPullAt: Date.now() })
    return { state: 'pulled' }
  })

  // Resolve conflito por escolha explícita: 'local' = force-push; 'remote' =
  // descarta local e importa o remoto.
  ipcMain.handle(
    'sync:resolve-conflict',
    async (_e, input: SyncResolveConflictInput): Promise<SyncNowResult> => {
      if (!isConfigured()) return { state: 'not-configured' }
      if (input.keep === 'local') {
        const res = await pushBundle(workdir(), getDb(), commitMessage(), {
          ...authOpts(),
          force: true,
        })
        if (res.pushed) updateSyncConfig({ lastPushAt: Date.now() })
        return { state: 'pushed' }
      }
      // keep === 'remote'
      await pull(workdir(), authOpts())
      await applyRemote(workdir())
      importBundle(getDb(), bundleDirFor(workdir()), watcherHooks())
      updateSyncConfig({ lastPullAt: Date.now() })
      return { state: 'pulled' }
    },
  )
}

// ---- boot ----
//
// CONSERVADOR e NÃO-FATAL: nunca clobbera trabalho local não-empurrado, nunca
// derruba o boot. Bounded por timeout. Regra:
//   - não configurado / offline / erro → no-op (status "stale", segue boot).
//   - origin à frente E local NÃO à frente (fast-forward) → applyRemote + import.
//   - diverged OU local à frente → NÃO importa (deixa pro usuário resolver na UI).
//   - em sync → no-op.
export async function syncOnBoot(timeoutMs = 8000): Promise<void> {
  if (!isConfigured()) return

  const work = async (): Promise<void> => {
    const dir = workdir()
    const opts = authOpts()
    const st = await pull(dir, opts)
    // Só importa no caminho fast-forward limpo (sem trabalho local pendente).
    if (st.behind > 0 && st.ahead === 0 && !st.diverged) {
      await applyRemote(dir)
      // Watcher ainda não iniciado no boot → active=false (o boot o inicia depois).
      importBundle(getDb(), bundleDirFor(dir), watcherHooks(false))
      updateSyncConfig({ lastPullAt: Date.now() })
    }
    // diverged | localAhead | in-sync → não toca nos dados.
  }

  try {
    await Promise.race([work(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  } catch (err) {
    // Offline/erro de git/import → boot segue com dados locais (status stale).
    console.warn('[sync] syncOnBoot falhou (não-fatal):', String((err as Error)?.message ?? err))
  }
}
