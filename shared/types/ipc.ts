// Tipos compartilhados main ↔ renderer via contextBridge.
// Toda feature nova adiciona seus tipos aqui e estende `Api` no preload.

export type LinkKind = 'inside' | 'symlink' | 'external'

export interface Project {
  id: string
  name: string
  color: string | null
  icon: string | null
  vaultPath: string | null
  createdAt: number
  updatedAt: number
}

export interface Repo {
  id: string
  projectId: string
  label: string
  path: string
  role: string | null
  linkKind: LinkKind
  source: string | null
  position: number
  createdAt: number
}

export interface Session {
  id: string
  repoId: string
  ccSessionId: string | null
  title: string | null
  paneId: string | null
  status: 'running' | 'exited' | 'crashed' | 'closed_by_user'
  startedAt: number
  endedAt: number | null
}

export interface CreateProjectInput {
  name: string
  color?: string | null
  icon?: string | null
  vaultPath?: string | null
}

export interface CreateRepoInput {
  projectId: string
  label: string
  path: string
  role?: string | null
  linkKind?: LinkKind
  source?: string | null
}

export interface SpawnSessionInput {
  repoId: string
  cols?: number
  rows?: number
}

export interface PtyDataEvent {
  sessionId: string
  data: string
}

export interface PtyExitEvent {
  sessionId: string
  exitCode: number
  signal: number | null
}

export interface Api {
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Project>
    delete(id: string): Promise<void>
    listRepos(projectId: string): Promise<Repo[]>
    createRepo(input: CreateRepoInput): Promise<Repo>
    deleteRepo(id: string): Promise<void>
  }
  sessions: {
    spawn(input: SpawnSessionInput): Promise<Session>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    kill(sessionId: string): Promise<void>
    rename(sessionId: string, title: string): Promise<void>
    list(): Promise<Session[]>
    onData(handler: (event: PtyDataEvent) => void): () => void
    onExit(handler: (event: PtyExitEvent) => void): () => void
  }
  shell: {
    openPath(path: string): Promise<void>
  }
  dialog: {
    openDirectory(): Promise<string | null>
  }
  vault: {
    getRoot(): Promise<string>
    isConfigured(): Promise<boolean>
    setRoot(root: string): Promise<void>
    ensureDir(path: string): Promise<{ created: boolean; wasEmpty: boolean }>
    isInside(vaultPath: string, target: string): Promise<boolean>
  }
  repo: {
    moveIntoVault(source: string, vaultPath: string, label: string): Promise<{ path: string }>
    symlinkIntoVault(source: string, vaultPath: string, label: string): Promise<{ path: string }>
    cloneUrl(url: string, vaultPath: string): Promise<{ path: string }>
  }
  workspace: {
    getActive(): Promise<string | null>
    setActive(projectId: string | null): Promise<void>
  }
}
