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

export interface UpdateProjectInput {
  id: string
  name?: string
  color?: string | null
  icon?: string | null
  vaultPath?: string | null
}

export interface UpdateRepoInput {
  id: string
  label?: string
  role?: string | null
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

export interface PaneSnapshot {
  ccSessionId: string
  repo: Repo
  projectName: string
  projectIcon: string | null
  // Opcional: snapshots gravados antes desta feature não têm a cor (fallback null).
  projectColor?: string | null
  // Opcional: id do painel no dockview. Preservado pra que o layout salvo (que
  // referencia painéis por id) bata ao restaurar. Snapshots antigos não têm.
  paneId?: string
}

export interface WorkspaceBootState {
  openPanes: PaneSnapshot[]
  cleanShutdown: boolean
  restoreAttempts: number
  // Layout serializado do dockview (api.toJSON()). null se nunca salvo.
  dockLayout: string | null
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

export type UpdateStatus =
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface PluginInfo {
  name: string
  marketplace: string
  enabled: boolean
}

// Referência a um componente individual de um plugin (skill, agent, etc).
export interface ComponentRef {
  name: string
  description?: string
}

export interface PluginComponents {
  skills: ComponentRef[]
  agents: ComponentRef[]
  commands: ComponentRef[]
  hooks: ComponentRef[]
  mcps: ComponentRef[]
}

// origin = 'user' (config user-level) ou o pluginId (`name@marketplace`).
export interface AgentInfo {
  name: string
  description: string
  origin: string
}

export interface SkillInfo {
  name: string
  description: string
  origin: string
}

export interface McpInfo {
  name: string
  kind: string
  origin: string
}

export interface HookInfo {
  event: string
  origin: string
  summary: string
}

export interface ClaudeConfigs {
  plugins: PluginInfo[]
  agents: AgentInfo[]
  skills: SkillInfo[]
  mcps: McpInfo[]
  hooks: HookInfo[]
}

// Plugin gerenciado via CLI do claude (`claude plugin ...`).
export interface ManagedPluginInfo {
  id: string
  name: string
  marketplace: string
  version: string
  scope: string
  enabled: boolean
  installedAt: string | null
  maintainer: string | null
  category: string | null
  description: string | null
  author: string | null
}

export interface AvailablePlugin {
  id: string
  name: string
  marketplace: string
  maintainer: string | null
  description?: string
  category: string | null
  author: string | null
}

export interface PluginDetails {
  name: string
  description: string
  source: string
  components: {
    skills: number
    agents: number
    hooks: number
    mcpServers: number
    lspServers: number
  }
  alwaysOnTokens?: number
  raw?: string
  // Componentes nomeados lidos do installPath (complementa as contagens acima).
  componentRefs?: PluginComponents
}

export type PluginAction = 'enable' | 'disable' | 'uninstall' | 'update' | 'install'

export interface PluginActionResult {
  ok: boolean
  message: string
  restartRequired: boolean
}

export interface Api {
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Project>
    update(input: UpdateProjectInput): Promise<Project>
    delete(id: string): Promise<void>
    listRepos(projectId: string): Promise<Repo[]>
    createRepo(input: CreateRepoInput): Promise<Repo>
    updateRepo(input: UpdateRepoInput): Promise<Repo>
    deleteRepo(id: string): Promise<void>
  }
  sessions: {
    spawn(input: SpawnSessionInput): Promise<Session>
    resume(input: ResumeSessionInput): Promise<Session>
    isResumable(ccSessionId: string): Promise<boolean>
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
    savePanes(panes: PaneSnapshot[]): Promise<void>
    saveLayout(layout: string | null): Promise<void>
    getBootState(): Promise<WorkspaceBootState>
    bumpRestoreAttempts(): Promise<void>
    resetRestoreAttempts(): Promise<void>
  }
  ccConfigs: {
    read(): Promise<ClaudeConfigs>
  }
  ccPlugins: {
    list(): Promise<ManagedPluginInfo[]>
    available(): Promise<AvailablePlugin[]>
    details(name: string): Promise<PluginDetails>
    action(action: PluginAction, name: string): Promise<PluginActionResult>
  }
  updates: {
    onStatus(handler: (status: UpdateStatus) => void): () => void
    install(): Promise<void>
  }
}
