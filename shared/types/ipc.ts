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
  name?: string
  cols?: number
  rows?: number
}

export interface ResumeSessionInput {
  repoId: string
  ccSessionId: string
  cols?: number
  rows?: number
}

export interface SessionSummary {
  ccSessionId: string
  name: string | null
  status: 'working' | 'waiting' | 'idle' | 'ended'
  lastActivityAt: number | null
  isLive: boolean
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

export interface SessionActivity {
  ccSessionId: string
  status: 'starting' | 'working' | 'waiting' | 'idle' | 'ended'
  name: string | null
  title: string | null
  lastText: string | null
  lastActivityAt: number | null
  tokens?: { output: number; context: number }
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
    resume(input: ResumeSessionInput): Promise<Session>
    listByRepo(repoId: string): Promise<SessionSummary[]>
    getBacklog(sessionId: string): Promise<string>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    kill(sessionId: string): Promise<void>
    rename(sessionId: string, title: string): Promise<void>
    list(): Promise<Session[]>
    onData(handler: (event: PtyDataEvent) => void): () => void
    onExit(handler: (event: PtyExitEvent) => void): () => void
    watchActivity(ccSessionId: string): Promise<void>
    unwatchActivity(ccSessionId: string): Promise<void>
    onActivity(handler: (event: SessionActivity) => void): () => void
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
