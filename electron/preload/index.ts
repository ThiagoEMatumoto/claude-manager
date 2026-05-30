import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Api,
  CreateProjectInput,
  CreateRepoInput,
  UpdateProjectInput,
  UpdateRepoInput,
  SpawnSessionInput,
  ResumeSessionInput,
  PtyDataEvent,
  PtyExitEvent,
  SessionActivity,
  PaneSnapshot,
} from '../../shared/types/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(
  channel: string,
  handler: (event: T) => void,
): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  projects: {
    list: () => invoke('projects:list'),
    create: (input: CreateProjectInput) => invoke('projects:create', input),
    update: (input: UpdateProjectInput) => invoke('projects:update', input),
    delete: (id: string) => invoke('projects:delete', id),
    listRepos: (projectId: string) => invoke('projects:repos:list', projectId),
    createRepo: (input: CreateRepoInput) => invoke('projects:repos:create', input),
    updateRepo: (input: UpdateRepoInput) => invoke('projects:repos:update', input),
    deleteRepo: (id: string) => invoke('projects:repos:delete', id),
  },
  sessions: {
    spawn: (input: SpawnSessionInput) => invoke('sessions:spawn', input),
    resume: (input: ResumeSessionInput) => invoke('sessions:resume', input),
    listByRepo: (repoId) => invoke('sessions:list-by-repo', repoId),
    getBacklog: (sessionId) => invoke('sessions:get-backlog', sessionId),
    write: (sessionId, data) => invoke('sessions:write', sessionId, data),
    resize: (sessionId, cols, rows) => invoke('sessions:resize', sessionId, cols, rows),
    kill: (sessionId) => invoke('sessions:kill', sessionId),
    rename: (sessionId, title) => invoke('sessions:rename', sessionId, title),
    list: () => invoke('sessions:list'),
    onData: (handler) => subscribe<PtyDataEvent>('pty:data', handler),
    onExit: (handler) => subscribe<PtyExitEvent>('pty:exit', handler),
    watchActivity: (ccSessionId) => invoke('session:activity:watch', ccSessionId),
    unwatchActivity: (ccSessionId) => invoke('session:activity:unwatch', ccSessionId),
    onActivity: (handler) => subscribe<SessionActivity>('session:activity', handler),
  },
  shell: {
    openPath: (path: string) => invoke('shell:open-path', path),
  },
  dialog: {
    openDirectory: () => invoke('dialog:open-directory'),
  },
  vault: {
    getRoot: () => invoke('vault:get-root'),
    isConfigured: () => invoke('vault:is-configured'),
    setRoot: (root: string) => invoke('vault:set-root', { root }),
    ensureDir: (path: string) => invoke('vault:ensure-dir', { path }),
    isInside: (vaultPath: string, target: string) =>
      invoke('vault:is-inside', { vaultPath, target }),
  },
  repo: {
    moveIntoVault: (source: string, vaultPath: string, label: string) =>
      invoke('repo:move-into-vault', { source, vaultPath, label }),
    symlinkIntoVault: (source: string, vaultPath: string, label: string) =>
      invoke('repo:symlink-into-vault', { source, vaultPath, label }),
    cloneUrl: (url: string, vaultPath: string) =>
      invoke('repo:clone-url', { url, vaultPath }),
  },
  workspace: {
    getActive: () => invoke('workspace:get-active'),
    setActive: (projectId: string | null) => invoke('workspace:set-active', { projectId }),
    savePanes: (panes: PaneSnapshot[]) => invoke('workspace:save-panes', { panes }),
    saveLayout: (layout: string | null) => invoke('workspace:save-layout', { layout }),
    getBootState: () => invoke('workspace:get-boot-state'),
    bumpRestoreAttempts: () => invoke('workspace:bump-restore-attempts'),
    resetRestoreAttempts: () => invoke('workspace:reset-restore-attempts'),
  },
  ccConfigs: {
    read: () => invoke('cc:read-configs'),
  },
  ccPlugins: {
    list: () => invoke('cc:plugins:list'),
    available: () => invoke('cc:plugins:available'),
    details: (name: string) => invoke('cc:plugins:details', { name }),
    action: (action, name) => invoke('cc:plugins:action', { action, name }),
  },
}

contextBridge.exposeInMainWorld('api', api)
