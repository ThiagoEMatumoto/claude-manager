import { app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../services/db'
import { startFeatureWatcher, stopFeatureWatcher } from '../services/feature-store'
import {
  applyRemote,
  bundleDirFor,
  ensureRepo,
  pull,
  pushBundle,
  status as gitStatus,
} from '../services/sync/git-sync'
import { importBundle } from '../services/sync/importer'
import { readSyncConfig, updateSyncConfig } from '../services/sync/sync-config'
import { SyncCoordinator, type SyncCoordinatorState } from '../services/sync/coordinator'
import type {
  SyncConfigureInput,
  SyncNowResult,
  SyncResolveConflictInput,
  SyncSetProjectsRootInput,
  SyncState,
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

function isConfigured(): boolean {
  return existsSync(join(workdir(), '.git'))
}

// ---- estado persistente de sync (sobrevive a reabrir o dialog) ----
//
// Atualizado por: syncOnBoot, o coordinator (auto-sync) e os handlers de ação.
// Vive no main (módulo), não na UI — a aba Sync apenas o lê via sync:status.
let lastSyncState: SyncState = 'idle'
let lastError: string | null = null
let lastSyncAt: number | null = null

function setSyncState(state: SyncState, error: string | null = null): void {
  lastSyncState = state
  lastError = error
  lastSyncAt = Date.now()
}

// Reconhece a mensagem do importer p/ schemaVersion remoto > local (app antigo).
function isSchemaMismatch(err: unknown): boolean {
  return /schemaVersion \d+ > local/.test(String((err as Error)?.message ?? err))
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
    projectsRoot: cfg.projectsRoot,
    lastPullAt: cfg.lastPullAt,
    lastPushAt: cfg.lastPushAt,
    schemaVersion,
    git,
    lastSyncState: effectiveState(configured, git),
    lastError,
    lastSyncAt,
  }
}

// O estado persistente (conflict/schema-mismatch/syncing/stale) tem prioridade —
// são sinais que o git status sozinho não expressa. Quando o estado é "neutro"
// (idle/in-sync/ahead/behind), derivamos do git status fresco para refletir
// ahead/behind reais sem depender de uma ação ter ocorrido.
function effectiveState(configured: boolean, git: SyncStatus['git']): SyncState {
  if (!configured) return 'idle'
  if (lastSyncState === 'conflict' || lastSyncState === 'schema-mismatch') return lastSyncState
  if (lastSyncState === 'syncing' || lastSyncState === 'stale') return lastSyncState
  if (git === null) return 'stale'
  if (git.ahead > 0 && git.behind > 0) return 'conflict'
  if (git.ahead > 0 || git.dirty) return 'ahead'
  if (git.behind > 0) return 'behind'
  return 'in-sync'
}

// ---- coordinator (auto-sync on-idle) ----
//
// Singleton: recebe pings de mutação (notifyMutation) e empurra após debounce.
// Reusa workdir/getDb/isConfigured/commitMessage da IPC; reflete o estado do
// push no estado persistente acima. A auth git é resolvida internamente pelo
// git-sync (credential helper do gh), sem opts.
export const syncCoordinator = new SyncCoordinator({
  workdir,
  getDb,
  isConfigured,
  commitMessage,
  syncOpts: gitSyncOpts,
  onState: (state: SyncCoordinatorState, info) => {
    if (state === 'syncing') setSyncState('syncing')
    else if (state === 'conflict') setSyncState('conflict')
    else if (state === 'stale') setSyncState('stale', info?.error ?? null)
    else if (state === 'in-sync') {
      setSyncState('in-sync')
      if (info?.pushedAt) updateSyncConfig({ lastPushAt: info.pushedAt })
    }
  },
})

// Ponto único de ping de mutação (chamado por notify.ts e projects.ts).
export function notifySyncMutation(): void {
  syncCoordinator.notifyMutation()
}

// ---- sync:now — pull → decidir import vs push, reportar conflito ----
//
// Conservador (mesma doutrina do boot):
//  - behind>0 e ahead==0 (fast-forward limpo) → applyRemote + importBundle.
//  - diverged (ahead>0 e behind>0)            → reporta conflito, NÃO toca dados.
//  - ahead>0 e behind==0 (ou em sync)          → export + push.
async function syncNow(): Promise<SyncNowResult> {
  if (!isConfigured()) return { state: 'not-configured' }
  const st = await pull(workdir())

  if (st.diverged) {
    setSyncState('conflict')
    return { state: 'conflict', ahead: st.ahead, behind: st.behind }
  }

  if (st.behind > 0 && st.ahead === 0) {
    await applyRemote(workdir())
    try {
      importBundle(getDb(), bundleDirFor(workdir()), watcherHooks())
    } catch (err) {
      if (isSchemaMismatch(err)) {
        setSyncState('schema-mismatch', String((err as Error)?.message ?? err))
        return { state: 'conflict', ahead: st.ahead, behind: st.behind }
      }
      throw err
    }
    updateSyncConfig({ lastPullAt: Date.now() })
    setSyncState('in-sync')
    return { state: 'pulled' }
  }

  // Nada a baixar com segurança → empurra estado local.
  const res = await pushBundle(workdir(), getDb(), commitMessage(), gitSyncOpts())
  if (res.rejected) {
    // origin avançou entre o pull e o push → conflito.
    const after = await pull(workdir())
    setSyncState('conflict')
    return { state: 'conflict', ahead: after.ahead, behind: after.behind }
  }
  if (res.pushed) {
    updateSyncConfig({ lastPushAt: Date.now() })
    setSyncState('in-sync')
    return { state: 'pushed' }
  }
  setSyncState('in-sync')
  return { state: 'up-to-date' }
}

function commitMessage(): string {
  const cfg = readSyncConfig()
  return `chore(sync): bundle from ${cfg.machineId} @ ${new Date().toISOString()}`
}

// Raiz dos projetos desta máquina (machine-local). Lida fresca a cada uso para
// refletir mudanças via sync:set-projects-root sem reiniciar.
function projectsRoot(): string | null {
  return readSyncConfig().projectsRoot
}

// Opções de export repassadas ao pushBundle: injeta o projectsRoot local para
// que os paths sob a raiz virem <CM_ROOT>/... no bundle (portáveis entre máquinas).
function gitSyncOpts() {
  return { exportOpts: { projectsRoot: projectsRoot() } }
}

// Hooks reais do watcher para o importBundle (pausa/reinicia o chokidar) +
// projectsRoot local (resolve <CM_ROOT>/... do bundle contra esta máquina).
// `active` = o watcher está rodando AGORA (boot ainda não o iniciou → false,
// então o import não o reinicia prematuramente; o boot o inicia depois).
function watcherHooks(active = true) {
  return {
    stopWatcher: stopFeatureWatcher,
    startWatcher: startFeatureWatcher,
    watcherWasActive: active,
    projectsRoot: projectsRoot(),
  }
}

// ---- registro IPC ----

export function registerSyncIpc(): void {
  ipcMain.handle('sync:status', (): Promise<SyncStatus> => buildStatus())

  ipcMain.handle('sync:configure', async (_e, input: SyncConfigureInput): Promise<SyncStatus> => {
    await ensureRepo(workdir(), input.repoUrl)
    updateSyncConfig({ repoUrl: input.repoUrl })
    return buildStatus()
  })

  // Define a pasta-raiz dos projetos desta máquina (machine-local). String vazia
  // → null (limpa a raiz). Não dispara sync; o próximo push/import já usa o valor.
  ipcMain.handle(
    'sync:set-projects-root',
    async (_e, input: SyncSetProjectsRootInput): Promise<SyncStatus> => {
      const root = input.root && input.root.trim().length > 0 ? input.root.trim() : null
      updateSyncConfig({ projectsRoot: root })
      return buildStatus()
    },
  )

  ipcMain.handle('sync:now', (): Promise<SyncNowResult> => syncNow())

  // Sobrescreve o REMOTO com o estado local (push --force).
  ipcMain.handle('sync:export-force', async (): Promise<SyncNowResult> => {
    if (!isConfigured()) return { state: 'not-configured' }
    const res = await pushBundle(workdir(), getDb(), commitMessage(), {
      ...gitSyncOpts(),
      force: true,
    })
    if (res.pushed) {
      updateSyncConfig({ lastPushAt: Date.now() })
      setSyncState('in-sync')
      return { state: 'pushed' }
    }
    setSyncState('in-sync')
    return { state: 'up-to-date' }
  })

  // Sobrescreve o LOCAL com o remoto (applyRemote + importBundle).
  ipcMain.handle('sync:import-force', async (): Promise<SyncNowResult> => {
    if (!isConfigured()) return { state: 'not-configured' }
    await pull(workdir())
    await applyRemote(workdir())
    try {
      importBundle(getDb(), bundleDirFor(workdir()), watcherHooks())
    } catch (err) {
      if (isSchemaMismatch(err)) {
        setSyncState('schema-mismatch', String((err as Error)?.message ?? err))
        throw err
      }
      throw err
    }
    updateSyncConfig({ lastPullAt: Date.now() })
    setSyncState('in-sync')
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
          ...gitSyncOpts(),
          force: true,
        })
        if (res.pushed) updateSyncConfig({ lastPushAt: Date.now() })
        setSyncState('in-sync')
        return { state: 'pushed' }
      }
      // keep === 'remote'
      await pull(workdir())
      await applyRemote(workdir())
      try {
        importBundle(getDb(), bundleDirFor(workdir()), watcherHooks())
      } catch (err) {
        if (isSchemaMismatch(err)) setSyncState('schema-mismatch', String((err as Error)?.message ?? err))
        throw err
      }
      updateSyncConfig({ lastPullAt: Date.now() })
      setSyncState('in-sync')
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
    const st = await pull(dir)
    // Só importa no caminho fast-forward limpo (sem trabalho local pendente).
    if (st.behind > 0 && st.ahead === 0 && !st.diverged) {
      await applyRemote(dir)
      try {
        // Watcher ainda não iniciado no boot → active=false (o boot o inicia depois).
        importBundle(getDb(), bundleDirFor(dir), watcherHooks(false))
      } catch (err) {
        // Bundle remoto exige app mais novo → registra schema-mismatch (a UI
        // mostra "atualize o app"), NÃO derruba o boot, mantém dados locais.
        if (isSchemaMismatch(err)) {
          setSyncState('schema-mismatch', String((err as Error)?.message ?? err))
          return
        }
        throw err
      }
      updateSyncConfig({ lastPullAt: Date.now() })
      setSyncState('in-sync')
    } else if (st.diverged) {
      // Divergência detectada no boot: persiste conflict para a UI mostrar SEM
      // precisar de "Sincronizar agora" (fecha o gap da Parte C).
      setSyncState('conflict')
    } else if (st.ahead > 0) {
      // Trabalho local não-empurrado (o coordinator empurrará no idle).
      setSyncState('ahead')
    } else {
      setSyncState('in-sync')
    }
  }

  try {
    await Promise.race([work(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  } catch (err) {
    // Offline/erro de git/import → boot segue com dados locais (status stale).
    setSyncState('stale', String((err as Error)?.message ?? err))
    console.warn('[sync] syncOnBoot falhou (não-fatal):', String((err as Error)?.message ?? err))
  }
}
