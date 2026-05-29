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
}

contextBridge.exposeInMainWorld('api', api)
