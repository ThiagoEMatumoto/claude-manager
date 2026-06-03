// Tipos compartilhados main ↔ renderer via contextBridge.
// Toda feature nova adiciona seus tipos aqui e estende `Api` no preload.

export type LinkKind = 'inside' | 'symlink' | 'external'

export interface Project {
  id: string
  name: string
  color: string | null
  icon: string | null
  vaultPath: string | null
  position: number
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

export interface ReorderReposInput {
  projectId: string
  repoIds: string[]
}

export interface SpawnSessionInput {
  repoId: string
  name?: string
  featureId?: string
  cols?: number
  rows?: number
}

export type FeatureStatus = 'pending' | 'in-progress' | 'blocked' | 'done' | 'paused'
export type FeatureSynthMode = 'auto' | 'manual' | 'threshold'

export interface FeatureRepoLink {
  repoId: string
  branch: string | null
  worktreePath: string | null
}

// Índice (campos do frontmatter) + o corpo Markdown. O `.md` é a fonte de
// verdade do corpo; o SQLite re-deriva os campos do frontmatter via watcher.
export interface Feature {
  id: string
  projectId: string
  slug: string
  title: string
  status: FeatureStatus
  objective: string | null
  docPath: string
  synthMode: FeatureSynthMode
  model: string | null
  repos: FeatureRepoLink[]
  createdAt: number
  updatedAt: number
  completedAt: number | null
  archivedAt: number | null
  // Corpo Markdown do `.md` (sem o frontmatter). Preenchido em `get`; ausente em `list`.
  body?: string
}

export interface CreateFeatureInput {
  projectId: string
  title: string
  objective?: string | null
  status?: FeatureStatus
  synthMode?: FeatureSynthMode
  model?: string | null
  repos?: FeatureRepoLink[]
  // Seções iniciais do corpo (preenchem o esqueleto de headings).
  overview?: string
  businessRules?: string
  approach?: string
}

export interface UpdateFeatureInput {
  id: string
  title?: string
  status?: FeatureStatus
  objective?: string | null
  synthMode?: FeatureSynthMode
  model?: string | null
}

export interface SetFeatureReposInput {
  id: string
  repos: FeatureRepoLink[]
}

export interface FeatureGroup {
  projectId: string
  features: Feature[]
}

// Emitido quando a síntese autônoma (fase 8) falha (timeout, exit≠0, output
// inválido). O `.md` não é tocado nesse caso; o evento só informa a UI.
export interface FeatureSynthError {
  featureId: string
  message: string
  at: number
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

// Snapshot de uma sessão viva (PTY rodando neste app) para a lista global "Agents".
// Cruza a linha do DB (id numérico/UUID, ccSessionId, repo) com o estado ao vivo
// dos sessions/<pid>.json e o enriquecimento do JSONL (lastText/tokens).
export interface LiveSessionInfo {
  id: string
  ccSessionId: string
  name: string | null
  title: string | null
  status: 'starting' | 'working' | 'waiting' | 'idle' | 'ended'
  repo: Repo
  projectName: string
  projectIcon: string | null
  projectColor: string | null
  lastActivityAt: number | null
  lastText: string | null
  tokens?: { output: number; context: number }
  isResumable?: boolean
}

// Batch de atualização de atividade de TODAS as sessões indexadas, emitido pelo
// watch global. Forma enxuta (sem repo/projeto) — o renderer já tem o snapshot.
export type GlobalActivityBatch = {
  ccSessionId: string
  status: 'starting' | 'working' | 'waiting' | 'idle' | 'ended'
  lastActivityAt: number | null
  lastText?: string | null
  tokens?: { output: number; context: number }
}[]

export type UpdateFormat = 'appimage' | 'deb' | 'dmg' | 'nsis' | 'zip'

export interface GithubAsset {
  name: string
  browser_download_url: string
}

export type UpdateStatus =
  | { state: 'available'; version: string; format?: UpdateFormat }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  // deb: instalação silenciosa via pkexec apt-get em andamento.
  | { state: 'installing'; version: string }
  // deb: instalado in-place; só falta relaunch.
  | { state: 'installed'; version: string }
  | { state: 'awaiting-install'; version: string }
  | { state: 'error'; message: string }

export interface UsageWindow {
  utilization: number
  resetsAt: string
}

export interface UsageStatus {
  state: 'ok' | 'no-token' | 'unauthorized' | 'error' | 'rate-limited'
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
  fetchedAt: number
  // Dados anexados são do último 'ok' conhecido (429/erro de rede transitório).
  stale?: boolean
}

export interface NotificationPrefs {
  enabled: boolean
  sessionWaiting: boolean
  usageHigh: boolean
}

export interface NotificationEvent {
  title: string
  body: string
  at: number
}

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

export type MetricsWindow = '7d' | '30d' | 'all'
export type SessionType = 'quick_chat' | 'iteration' | 'deep_solo' | 'agent_orchestration'

export interface MetricsTotals {
  sessions: number
  turns: number
  agentCalls: number
  skillCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  // cacheRead / (cacheRead + input)
  cacheHitRate: number
  // parallelRounds / agentRounds (0 se agentRounds==0)
  parallelizationRatio: number
  // agentCalls / (agentCalls + inlineExploreCalls) (0 se denom==0)
  inlineDelegationRatio: number
}

export interface MetricsDayPoint {
  day: string
  tokens: number
  costUsd: number
  turns: number
  sessions: number
}

export interface MetricsSessionRow {
  ccSessionId: string
  title: string | null
  sessionType: SessionType
  turns: number
  agentCalls: number
  costUsd: number
  lastTs: number | null
  projectId: string | null
  projectName: string
}

export interface MetricsProjectRow {
  projectId: string | null
  projectName: string
  sessions: number
  turns: number
  costUsd: number
  tokens: number
}

export interface MetricsToolRow {
  name: string
  count: number
}

export interface MetricsTypeBucket {
  type: SessionType
  sessions: number
  turns: number
  costUsd: number
}

export interface MetricsSnapshot {
  window: MetricsWindow
  generatedAt: number
  scanned: boolean
  totals: MetricsTotals
  perDay: MetricsDayPoint[]
  perSession: MetricsSessionRow[]
  perProject: MetricsProjectRow[]
  sessionTypeDistribution: MetricsTypeBucket[]
  // distribuição de subagent_type sobre os tool_use Agent (desc por count)
  subagentTypeDistribution: { type: string; count: number }[]
  topTools: MetricsToolRow[]
  // modelos sem preço → custo parcial (aviso na UI)
  unknownModels: string[]
}

export interface MetricsScanProgress {
  processed: number
  total: number
  done: boolean
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
}

export interface Api {
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Project>
    update(input: UpdateProjectInput): Promise<Project>
    delete(id: string): Promise<void>
    reorder(ids: string[]): Promise<void>
    listRepos(projectId: string): Promise<Repo[]>
    createRepo(input: CreateRepoInput): Promise<Repo>
    updateRepo(input: UpdateRepoInput): Promise<Repo>
    deleteRepo(id: string): Promise<void>
    reorderRepos(input: ReorderReposInput): Promise<void>
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
    listLiveGlobal(): Promise<LiveSessionInfo[]>
    watchGlobalActivity(): void
    unwatchGlobalActivity(): void
    onGlobalActivity(handler: (batch: GlobalActivityBatch) => void): () => void
  }
  shell: {
    openPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  app: {
    getInfo(): Promise<AppInfo>
  }
  dialog: {
    openDirectory(): Promise<string | null>
  }
  prefs: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
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
    removeSymlink(target: string): Promise<{ removed: boolean }>
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
    apply(): Promise<void>
    install(): Promise<void>
    openRelease(): Promise<void>
    openDownloads(): Promise<void>
  }
  usage: {
    get(): Promise<UsageStatus>
    refresh(): Promise<UsageStatus>
    onStatus(handler: (status: UsageStatus) => void): () => void
  }
  metrics: {
    get(window: MetricsWindow): Promise<MetricsSnapshot>
    refresh(): Promise<MetricsSnapshot>
    onProgress(handler: (p: MetricsScanProgress) => void): () => void
  }
  features: {
    list(projectId?: string): Promise<Feature[]>
    get(id: string): Promise<Feature | null>
    create(input: CreateFeatureInput): Promise<Feature>
    update(input: UpdateFeatureInput): Promise<Feature>
    archive(id: string): Promise<void>
    setRepos(input: SetFeatureReposInput): Promise<Feature>
    onUpdated(handler: (feature: Feature) => void): () => void
    onSynthError(handler: (event: FeatureSynthError) => void): () => void
  }
  notifications: {
    onEvent(handler: (event: NotificationEvent) => void): () => void
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(handler: (maximized: boolean) => void): () => void
  }
}
