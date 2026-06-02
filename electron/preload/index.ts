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
  GlobalActivityBatch,
  PaneSnapshot,
  UpdateStatus,
  UsageStatus,
  NotificationEvent,
  MetricsWindow,
  MetricsScanProgress,
  Feature,
  CreateFeatureInput,
  UpdateFeatureInput,
  SetFeatureReposInput,
  FeatureSynthError,
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
    isResumable: (ccSessionId) => invoke('sessions:is-resumable', ccSessionId),
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
    listLiveGlobal: () => invoke('sessions:list-live-global'),
    watchGlobalActivity: () => {
      void invoke('session:activity:watch-global')
    },
    unwatchGlobalActivity: () => {
      void invoke('session:activity:unwatch-global')
    },
    onGlobalActivity: (handler) =>
      subscribe<GlobalActivityBatch>('session:activity:global', handler),
  },
  shell: {
    openPath: (path: string) => invoke('shell:open-path', path),
    openExternal: (url: string) => invoke('shell:open-external', url),
  },
  app: {
    getInfo: () => invoke('app:get-info'),
  },
  dialog: {
    openDirectory: () => invoke('dialog:open-directory'),
  },
  prefs: {
    get: <T>(key: string) => invoke<T | null>('prefs:get', { key }),
    set: (key: string, value: unknown) => invoke('prefs:set', { key, value }),
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
  updates: {
    onStatus: (handler) => subscribe<UpdateStatus>('update:status', handler),
    apply: () => invoke('updates:apply'),
    install: () => invoke('updates:install'),
    openRelease: () => invoke('updates:open-release'),
  },
  usage: {
    get: () => invoke('usage:get'),
    refresh: () => invoke('usage:refresh'),
    onStatus: (handler) => subscribe<UsageStatus>('usage:status', handler),
  },
  metrics: {
    get: (window: MetricsWindow) => invoke('metrics:get', window),
    refresh: () => invoke('metrics:refresh'),
    onProgress: (handler) => subscribe<MetricsScanProgress>('metrics:progress', handler),
  },
  features: {
    list: (projectId?: string) => invoke('features:list', projectId),
    get: (id: string) => invoke('features:get', id),
    create: (input: CreateFeatureInput) => invoke('features:create', input),
    update: (input: UpdateFeatureInput) => invoke('features:update', input),
    archive: (id: string) => invoke('features:archive', id),
    setRepos: (input: SetFeatureReposInput) => invoke('features:set-repos', input),
    onUpdated: (handler) => subscribe<Feature>('feature:updated', handler),
    onSynthError: (handler) => subscribe<FeatureSynthError>('feature:synth-error', handler),
  },
  notifications: {
    onEvent: (handler) => subscribe<NotificationEvent>('notify:event', handler),
  },
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:is-maximized'),
    onMaximizeChange: (handler) => subscribe<boolean>('window:maximize-changed', handler),
  },
}

contextBridge.exposeInMainWorld('api', api)
