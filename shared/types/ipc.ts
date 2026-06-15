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

// Pasta que existe fisicamente dentro do vault de um projeto mas ainda não foi
// registrada como repo. Surge quando o usuário clona/cria a pasta por fora do app.
export interface UntrackedFolder {
  name: string
  path: string
}

export interface Session {
  id: string
  // null = sessão avulsa (sem repo), rodando no scratch dir.
  repoId: string | null
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
  // Ausente/null = sessão avulsa: cwd vira o scratch dir (pref scratch_dir).
  repoId?: string | null
  name?: string
  featureId?: string
  // Comando inicial injetado no REPL do claude após o spawn (ex.: '/review' ou
  // o nome de uma skill). Escrito no PTY no primeiro `data` da sessão, não como
  // flag de CLI — slash commands são input interativo do REPL.
  initialCommand?: string
  // Modelo inicial da sessão (alias: 'opus' | 'sonnet' | 'haiku'). Validado
  // contra whitelist no main e anexado ao spawn como `--model <alias>`.
  // Ausente = default do claude.
  model?: string
  cols?: number
  rows?: number
}

export type FeatureStatus = 'pending' | 'in-progress' | 'blocked' | 'done' | 'paused'
export type FeatureSynthMode = 'auto' | 'manual' | 'threshold'
// 'manual' = criada pelo usuário; 'auto' = auto-criada pela resolução de sessões.
// Rascunho oculto = origin='auto' E 0 session records (derivado, sem flag mutável).
export type FeatureOrigin = 'manual' | 'auto'

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
  // Vive só no SQLite (como archivedAt) — não vai pro frontmatter do `.md`.
  origin: FeatureOrigin
  createdAt: number
  updatedAt: number
  completedAt: number | null
  archivedAt: number | null
  // Corpo Markdown do `.md` (sem o frontmatter). Preenchido em `get`; ausente em `list`.
  body?: string
}

// Feature do índice + stats de atividade real. Usado pelo board e pela
// listagem (ordenação/badges); sem corpo, igual a list().
export interface FeatureWithStats extends Feature {
  sessionCount: number
  // Registros em feature_session_records (0 = "sem registros").
  recordCount: number
  // session_at do registro mais recente; null sem registros. A listagem ordena
  // por COALESCE(lastRecordAt, updatedAt) DESC (atividade real > metadado).
  lastRecordAt: number | null
}

export interface FeatureListStatsOpts {
  includeArchived?: boolean
  includeDrafts?: boolean
}

export interface CreateFeatureInput {
  projectId: string
  title: string
  objective?: string | null
  status?: FeatureStatus
  synthMode?: FeatureSynthMode
  model?: string | null
  repos?: FeatureRepoLink[]
  // Default 'manual'. A resolução automática de sessões passa 'auto' (rascunho
  // oculto até a feature ganhar o 1º session record).
  origin?: FeatureOrigin
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

// Resultado do backfill retroativo (reprocessamento de sessões já encerradas).
export interface FeatureBackfillResult {
  created: number
  linked: number
  skipped: number
}

// ---- Vínculos Feature → Objetivo/KR (Fase 3) ----

export type FeatureLinkTargetType = 'objective' | 'key_result'

// Vínculo polimórfico feature → objetivo/KR (sem FK real em targetId, espelho
// de TaskLink). Alimenta o rollup de objetivos/KRs auto_rollup.
export interface FeatureObjectiveLink {
  targetType: FeatureLinkTargetType
  targetId: string
}

export interface SetFeatureObjectiveLinksInput {
  featureId: string
  links: FeatureObjectiveLink[]
}

// Projeção enxuta de uma feature vinculada, pronta pra UI de Objetivos.
// progress = % de tarefas done da feature (ou 100 se status done sem tarefas;
// null = indeterminado, fica fora do rollup do pai).
export interface LinkedFeatureSummary {
  id: string
  title: string
  status: FeatureStatus
  progress: number | null
}

// ---- Objetivos / Key Results (camada genérica de OKRs, Fase 1) ----

export type ObjectiveKind = 'okr' | 'personal_goal' | 'project' | 'custom'
export type ObjectiveStatus = 'active' | 'paused' | 'done' | 'archived'
export type KeyResultStatus = 'active' | 'paused' | 'done' | 'cancelled'
export type ProgressMode = 'auto_rollup' | 'metric' | 'manual'
export type ProgressDirection = 'increase' | 'decrease' | 'maintain'

// Persistência SQLite-only (sem espelho .md). tags são strings opacas (JSON na
// coluna); progresso NÃO é persistido — calculado via shared/progress.ts.
export interface Objective {
  id: string
  title: string
  description: string | null
  kind: ObjectiveKind
  status: ObjectiveStatus
  period: string | null
  startDate: number | null
  endDate: number | null
  parentObjectiveId: string | null
  priority: 'low' | 'medium' | 'high' | null
  owner: string | null
  tags: string[]
  progressMode: ProgressMode
  // Escala 0–100 (null = indeterminado).
  progressManual: number | null
  baseline: number | null
  current: number | null
  target: number | null
  unit: string | null
  direction: ProgressDirection | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
  archivedAt: number | null
}

export interface KeyResult {
  id: string
  objectiveId: string
  title: string
  owner: string | null
  status: KeyResultStatus
  // Peso no rollup do objetivo (default 1 quando null).
  weight: number | null
  progressMode: ProgressMode
  progressManual: number | null
  baseline: number | null
  current: number | null
  target: number | null
  unit: string | null
  direction: ProgressDirection | null
  createdAt: number
  updatedAt: number
}

// Objective enriquecido com o progresso calculado (0–100; null = indeterminado,
// a UI mostra "—").
export interface ObjectiveWithProgress extends Objective {
  progress: number | null
}

// Detalhe: objetivo + KRs (cada um com seu progresso calculado) + features
// vinculadas (Fase 3) — no nível do objetivo e por KR.
export interface ObjectiveDetail extends ObjectiveWithProgress {
  keyResults: Array<KeyResult & { progress: number | null; linkedFeatures: LinkedFeatureSummary[] }>
  linkedFeatures: LinkedFeatureSummary[]
}

export interface CreateObjectiveInput {
  title: string
  description?: string | null
  kind: ObjectiveKind
  status?: ObjectiveStatus
  period?: string | null
  startDate?: number | null
  endDate?: number | null
  parentObjectiveId?: string | null
  priority?: 'low' | 'medium' | 'high' | null
  owner?: string | null
  tags?: string[]
  progressMode?: ProgressMode
  progressManual?: number | null
  baseline?: number | null
  current?: number | null
  target?: number | null
  unit?: string | null
  direction?: ProgressDirection | null
}

export interface UpdateObjectiveInput {
  id: string
  title?: string
  description?: string | null
  kind?: ObjectiveKind
  status?: ObjectiveStatus
  period?: string | null
  startDate?: number | null
  endDate?: number | null
  parentObjectiveId?: string | null
  priority?: 'low' | 'medium' | 'high' | null
  owner?: string | null
  tags?: string[]
  progressMode?: ProgressMode
  progressManual?: number | null
  baseline?: number | null
  current?: number | null
  target?: number | null
  unit?: string | null
  direction?: ProgressDirection | null
}

export interface CreateKeyResultInput {
  objectiveId: string
  title: string
  owner?: string | null
  status?: KeyResultStatus
  weight?: number | null
  progressMode?: ProgressMode
  progressManual?: number | null
  baseline?: number | null
  current?: number | null
  target?: number | null
  unit?: string | null
  direction?: ProgressDirection | null
}

export interface UpdateKeyResultInput {
  id: string
  title?: string
  owner?: string | null
  status?: KeyResultStatus
  weight?: number | null
  progressMode?: ProgressMode
  progressManual?: number | null
  baseline?: number | null
  current?: number | null
  target?: number | null
  unit?: string | null
  direction?: ProgressDirection | null
}

export interface ObjectiveListFilter {
  kind?: ObjectiveKind
  status?: ObjectiveStatus
  tags?: string[]
  search?: string
}

// ---- Tarefas (Fase 2) ----

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskParentType = 'objective' | 'key_result' | 'feature'

// Vínculo polimórfico tarefa → parent (sem FK real em parentId; tarefa
// standalone = sem vínculos). Alimenta o rollup de KRs/objetivos auto_rollup.
export interface TaskLink {
  parentType: TaskParentType
  parentId: string
}

// Persistência SQLite-only (mesmo padrão de Objective): tags são strings
// opacas (JSON na coluna); position REAL p/ ordenação manual.
export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority | null
  dueDate: number | null
  startedAt: number | null
  completedAt: number | null
  tags: string[]
  notes: string | null
  position: number
  links: TaskLink[]
  createdAt: number
  updatedAt: number
}

export interface CreateTaskInput {
  title: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority | null
  dueDate?: number | null
  tags?: string[]
  notes?: string | null
  position?: number
  links?: TaskLink[]
}

export interface UpdateTaskInput {
  id: string
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority | null
  dueDate?: number | null
  tags?: string[]
  notes?: string | null
  position?: number
}

export interface TaskListFilter {
  status?: TaskStatus
  priority?: TaskPriority
  tag?: string
  search?: string
  parentType?: TaskParentType
  parentId?: string
}

// ---- Dashboard / visão hierárquica (Fase 4) ----

// Projeção enxuta de tarefa pros nós da árvore do dashboard.
export interface OverviewTaskSummary {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  dueDate: number | null
}

// Mesmo shape de LinkedFeatureSummary — alias nomeado pro contexto do overview.
export type OverviewFeatureSummary = LinkedFeatureSummary

export interface OverviewKeyResultNode {
  keyResult: KeyResult
  progress: number | null
  tasks: OverviewTaskSummary[]
  linkedFeatures: OverviewFeatureSummary[]
}

export interface OverviewObjectiveNode {
  objective: Objective
  progress: number | null
  keyResults: OverviewKeyResultNode[]
  // Tarefas vinculadas direto ao objetivo (sem passar por KR).
  directTasks: OverviewTaskSummary[]
  linkedFeatures: OverviewFeatureSummary[]
  // Sub-objetivos via parent_objective_id.
  children: OverviewObjectiveNode[]
}

// Referência resolvida (com título do pai) de uma tarefa pendente, p/ exibição.
export interface OverviewTaskParentRef {
  type: TaskParentType
  id: string
  title: string
}

// Tarefa pendente (todo|in_progress|blocked) com os parents resolvidos.
export type OverviewPendingTask = Task & { parents: OverviewTaskParentRef[] }

export interface OverviewCounts {
  activeObjectives: number
  pendingTasks: number
  // dueToday = due_date dentro do dia local corrente; overdue = antes do
  // começo do dia local (ambos só sobre tarefas pendentes).
  dueToday: number
  overdue: number
}

// Feature em andamento com a atividade real de sessões (card da Home):
// lastSessionAt = MAX(COALESCE(ended_at, started_at)) das sessions com
// feature_id apontando pra ela; null = nenhuma sessão linkada ainda.
export interface OverviewFeatureActivity {
  id: string
  title: string
  status: FeatureStatus
  projectId: string
  lastSessionAt: number | null
  sessionCount: number
}

// Payload agregado do dashboard: a árvore inteira numa chamada IPC (evita N+1
// de get/listByParent a partir do renderer).
export interface OverviewData {
  // Raízes (parent null) com status active|paused|done — archived fica fora.
  objectives: OverviewObjectiveNode[]
  // Pendentes ordenadas: prioridade (high>medium>low>null) → dueDate asc
  // (null por último) → position.
  pending: OverviewPendingTask[]
  counts: OverviewCounts
  // Features ativas (in-progress|blocked|paused, não-arquivadas) com atividade
  // de sessões, ordenadas pela última sessão (fallback updated_at) desc.
  features: OverviewFeatureActivity[]
}

export interface ResumeSessionInput {
  // null = sessão avulsa: retoma no scratch dir.
  repoId: string | null
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
  // null = sessão avulsa (sem repo/projeto).
  repo: Repo | null
  projectName: string | null
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
  // Model id da última msg assistant do transcript (ex: 'claude-opus-4-...').
  // Null até a primeira resposta — fonte de verdade pro ModelPill do Terminal.
  model: string | null
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
  // null = sessão avulsa (sem repo/projeto).
  repo: Repo | null
  projectName: string | null
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

// Item lançável pela command palette: uma skill ou um slash command, de origin
// 'user' ou pluginId. O `kind` decide a injeção no REPL ('/'+name p/ command).
export interface CommandInfo {
  name: string
  description: string
  origin: string
}

export interface LauncherItem {
  name: string
  description: string
  origin: string
  kind: 'skill' | 'command'
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
  // totais da janela imediatamente anterior (p/ delta). Ausente em 'all'.
  previousTotals?: MetricsTotals
  perDay: MetricsDayPoint[]
  perSession: MetricsSessionRow[]
  perProject: MetricsProjectRow[]
  sessionTypeDistribution: MetricsTypeBucket[]
  // distribuição de subagent_type sobre os tool_use Agent (desc por count)
  subagentTypeDistribution: { type: string; count: number }[]
  // sessões por modelo (de models_json; sessão multi-modelo conta em cada um)
  modelDistribution: { model: string; sessions: number }[]
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

// Status read-only do MCP server embutido (Settings → Geral). addCommand é o
// `claude mcp add ...` pronto (inclui o bearer token) pra sessões externas.
export interface McpStatus {
  running: boolean
  port: number | null
  url: string | null
  addCommand: string | null
}

// ---- Sincronização git-backed (Fase 2) ----

export interface SyncGitStatus {
  dirty: boolean
  ahead: number
  behind: number
  lastCommit: string | null
}

// Estado persistente de sync, atualizado pelo boot, pelo coordinator (auto-sync)
// e pelas ações manuais. Sobrevive a reabrir o dialog (mora no main, não na UI).
//  - idle            — sem repo configurado.
//  - in-sync         — em paridade com o remoto.
//  - ahead           — trabalho local não-empurrado.
//  - behind          — remoto à frente (há o que importar).
//  - syncing         — operação em andamento.
//  - conflict        — divergência (escolha do usuário necessária).
//  - schema-mismatch — bundle remoto exige app mais novo (bloqueado).
//  - stale           — offline/erro não-fatal; opera com dados locais.
export type SyncState =
  | 'idle'
  | 'in-sync'
  | 'ahead'
  | 'behind'
  | 'syncing'
  | 'conflict'
  | 'schema-mismatch'
  | 'stale'

// Snapshot agregado para a aba Sync: config machine-local + git + schema +
// estado persistente derivado do boot/coordinator/ações.
export interface SyncStatus {
  configured: boolean
  repoUrl: string | null
  machineId: string
  // Raiz absoluta dos projetos NESTA máquina (machine-local). null = não definida.
  // Paths sob ela viram <CM_ROOT>/... no bundle → portáveis entre máquinas.
  projectsRoot: string | null
  lastPullAt: number | null
  lastPushAt: number | null
  schemaVersion: number
  // null quando não configurado ou git indisponível (offline/erro).
  git: SyncGitStatus | null
  // Estado persistente (último resultado conhecido de boot/auto-sync/ação).
  lastSyncState: SyncState
  // Mensagem do último erro não-fatal (offline/transport), se houver.
  lastError: string | null
  // Quando o último estado foi registrado.
  lastSyncAt: number | null
}

export interface SyncConfigureInput {
  repoUrl: string
}

export interface SyncResolveConflictInput {
  keep: 'local' | 'remote'
}

// Define a pasta-raiz dos projetos desta máquina. root vazio → limpa (null).
export interface SyncSetProjectsRootInput {
  root: string
}

// Resultado de uma operação de sync. 'conflict' carrega ahead/behind p/ a UI.
export type SyncNowResult =
  | { state: 'not-configured' }
  | { state: 'up-to-date' }
  | { state: 'pushed' }
  | { state: 'pulled' }
  | { state: 'conflict'; ahead: number; behind: number }

// Resultado de um backup manual em .zip (independente do git). 'canceled' =
// o usuário fechou o dialog. 'exported'/'imported' carregam o path do .zip.
export type SyncBackupResult =
  | { state: 'canceled' }
  | { state: 'exported'; path: string }
  | { state: 'imported'; path: string }

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
    listUntracked(projectId: string): Promise<UntrackedFolder[]>
  }
  repo: {
    moveIntoVault(source: string, vaultPath: string, label: string): Promise<{ path: string }>
    symlinkIntoVault(source: string, vaultPath: string, label: string): Promise<{ path: string }>
    removeSymlink(target: string): Promise<{ removed: boolean }>
    cloneUrl(url: string, vaultPath: string): Promise<{ path: string }>
    createBlank(vaultPath: string, name: string, gitInit: boolean): Promise<{ path: string }>
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
    listLauncherItems(): Promise<LauncherItem[]>
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
    listWithStats(opts?: FeatureListStatsOpts): Promise<FeatureWithStats[]>
    get(id: string): Promise<Feature | null>
    create(input: CreateFeatureInput): Promise<Feature>
    update(input: UpdateFeatureInput): Promise<Feature>
    archive(id: string): Promise<void>
    setRepos(input: SetFeatureReposInput): Promise<Feature>
    setObjectiveLinks(input: SetFeatureObjectiveLinksInput): Promise<Feature>
    listObjectiveLinks(featureId: string): Promise<FeatureObjectiveLink[]>
    backfill(): Promise<FeatureBackfillResult>
    onUpdated(handler: (feature: Feature) => void): () => void
    onSynthError(handler: (event: FeatureSynthError) => void): () => void
  }
  objectives: {
    list(filter?: ObjectiveListFilter): Promise<ObjectiveWithProgress[]>
    get(id: string): Promise<ObjectiveDetail | null>
    overview(): Promise<OverviewData>
    create(input: CreateObjectiveInput): Promise<Objective>
    update(input: UpdateObjectiveInput): Promise<Objective>
    archive(id: string): Promise<void>
    createKeyResult(input: CreateKeyResultInput): Promise<KeyResult>
    updateKeyResult(input: UpdateKeyResultInput): Promise<KeyResult>
    deleteKeyResult(id: string): Promise<void>
    // Payload varia por mutação (Objective completo, ou marcador {id, archived}
    // / {keyResultId, ...}) — o renderer trata como sinal de recarga.
    onUpdated(handler: (payload: unknown) => void): () => void
  }
  tasks: {
    list(filter?: TaskListFilter): Promise<Task[]>
    get(id: string): Promise<Task | null>
    listByParent(parentType: TaskParentType, parentId: string): Promise<Task[]>
    create(input: CreateTaskInput): Promise<Task>
    update(input: UpdateTaskInput): Promise<Task>
    delete(id: string): Promise<void>
    setLinks(taskId: string, links: TaskLink[]): Promise<Task>
    reorder(taskId: string, position: number): Promise<Task>
    // Payload varia por mutação (Task completa ou marcador {id, deleted}) —
    // o renderer trata como sinal de recarga. Mutações com parent
    // objective/key_result também emitem 'objective:updated' com {id}.
    onUpdated(handler: (payload: unknown) => void): () => void
  }
  notifications: {
    onEvent(handler: (event: NotificationEvent) => void): () => void
  }
  mcp: {
    status(): Promise<McpStatus>
  }
  sync: {
    status(): Promise<SyncStatus>
    configure(input: SyncConfigureInput): Promise<SyncStatus>
    setProjectsRoot(input: SyncSetProjectsRootInput): Promise<SyncStatus>
    now(): Promise<SyncNowResult>
    exportForce(): Promise<SyncNowResult>
    importForce(): Promise<SyncNowResult>
    resolveConflict(input: SyncResolveConflictInput): Promise<SyncNowResult>
    // Backup manual em .zip (independente do git; abre dialog no main).
    backupExport(): Promise<SyncBackupResult>
    backupImport(): Promise<SyncBackupResult>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(handler: (maximized: boolean) => void): () => void
  }
}
