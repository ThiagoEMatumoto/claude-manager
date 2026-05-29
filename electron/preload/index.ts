import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Api,
  CreateProjectInput,
  CreateRepoInput,
  SpawnSessionInput,
  PtyDataEvent,
  PtyExitEvent,
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
    delete: (id: string) => invoke('projects:delete', id),
    listRepos: (projectId: string) => invoke('projects:repos:list', projectId),
    createRepo: (input: CreateRepoInput) => invoke('projects:repos:create', input),
    deleteRepo: (id: string) => invoke('projects:repos:delete', id),
  },
  sessions: {
    spawn: (input: SpawnSessionInput) => invoke('sessions:spawn', input),
    write: (sessionId, data) => invoke('sessions:write', sessionId, data),
    resize: (sessionId, cols, rows) => invoke('sessions:resize', sessionId, cols, rows),
    kill: (sessionId) => invoke('sessions:kill', sessionId),
    rename: (sessionId, title) => invoke('sessions:rename', sessionId, title),
    list: () => invoke('sessions:list'),
    onData: (handler) => subscribe<PtyDataEvent>('pty:data', handler),
    onExit: (handler) => subscribe<PtyExitEvent>('pty:exit', handler),
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
  },
}

contextBridge.exposeInMainWorld('api', api)
