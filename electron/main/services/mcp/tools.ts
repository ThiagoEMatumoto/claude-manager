// Tools MCP — handlers finos: validação zod → store → notify → retorno.
// Sem lógica de negócio própria; os broadcasts espelham 1:1 o que a camada IPC
// emite (mesmos canais/payloads), então a UI atualiza ao vivo pra writes MCP.
// Sem deletes destrutivos: archive (reversível) é o máximo de remoção exposto.
import * as z from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/server'
import * as objectiveStore from '../objective-store'
import * as overviewStore from '../overview-store'
import * as taskStore from '../task-store'
import * as featureStore from '../feature-store'
import * as repoDepStore from '../repo-dependency-store'
import * as handoffStore from '../handoff-store'
import { composeHandoffPrompt, type HandoffEdge } from '../handoff/compose-prompt'
import { getDb } from '../db'
import { getPref } from '../prefs-store'
import { randomUUID } from 'node:crypto'
import type {
  FeatureObjectiveLink,
  RepoDependency,
  TaskLink,
} from '../../../../shared/types/ipc'

// Injeção do broadcast (testável sem electron/janelas): o server monta a
// implementação real a partir de services/notify.ts.
export interface McpNotify {
  broadcast(channel: string, payload: unknown): void
  affectedObjectives(links: TaskLink[]): void
  affectedObjectivesForFeatureLinks(links: FeatureObjectiveLink[]): void
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
  [key: string]: unknown
}

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: z.ZodType
  handler: (args: unknown) => ToolResult
}

// structuredContent precisa ser objeto JSON (spec); listas vão como { items }.
function ok(structured: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  }
}

// ---- enums espelhando shared/types/ipc.ts ----

const objectiveKind = z.enum(['okr', 'personal_goal', 'project', 'custom'])
const objectiveStatus = z.enum(['active', 'paused', 'done', 'archived'])
const keyResultStatus = z.enum(['active', 'paused', 'done', 'cancelled'])
const progressMode = z.enum(['auto_rollup', 'metric', 'manual'])
const progressDirection = z.enum(['increase', 'decrease', 'maintain'])
const priority = z.enum(['low', 'medium', 'high'])

// Campos de métrica compartilhados por objetivos e KRs (todos opcionais).
const metricFields = {
  progressMode: progressMode.optional(),
  progressManual: z.number().min(0).max(100).nullish(),
  baseline: z.number().nullish(),
  current: z.number().nullish(),
  target: z.number().nullish(),
  unit: z.string().nullish(),
  direction: progressDirection.nullish(),
}

// ---- objectives / key results ----

const objectiveListSchema = z.object({
  kind: objectiveKind.optional(),
  status: objectiveStatus.optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
})

const idSchema = z.object({ id: z.string().min(1) })

// Espelha CreateObjectiveInput.
const objectiveCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  kind: objectiveKind,
  status: objectiveStatus.optional(),
  period: z.string().nullish(),
  startDate: z.number().nullish(),
  endDate: z.number().nullish(),
  parentObjectiveId: z.string().nullish(),
  priority: priority.nullish(),
  owner: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  ...metricFields,
})

// Espelha UpdateObjectiveInput (id obrigatório, resto parcial).
const objectiveUpdateSchema = objectiveCreateSchema
  .partial()
  .extend({ id: z.string().min(1) })

// Espelha CreateKeyResultInput.
const keyResultCreateSchema = z.object({
  objectiveId: z.string().min(1),
  title: z.string().min(1),
  owner: z.string().nullish(),
  status: keyResultStatus.optional(),
  weight: z.number().nullish(),
  ...metricFields,
})

// Espelha UpdateKeyResultInput.
const keyResultUpdateSchema = keyResultCreateSchema
  .partial()
  .omit({ objectiveId: true })
  .extend({ id: z.string().min(1) })

function objectiveTools(notify: McpNotify): ToolDef[] {
  return [
    {
      name: 'objective_list',
      title: 'List objectives',
      description:
        'List objectives (OKRs, personal goals, projects) with computed progress (0-100, null = indeterminate). Optional filters: kind, status, tags, free-text search.',
      inputSchema: objectiveListSchema,
      handler: (args) => {
        const filter = objectiveListSchema.parse(args)
        return ok({ items: objectiveStore.list(filter) })
      },
    },
    {
      name: 'objective_get',
      title: 'Get objective detail',
      description:
        'Get one objective by id, including key results (with progress) and linked features. Returns { objective: null } when not found.',
      inputSchema: idSchema,
      handler: (args) => {
        const { id } = idSchema.parse(args)
        return ok({ objective: objectiveStore.get(id) })
      },
    },
    {
      name: 'objective_create',
      title: 'Create objective',
      description:
        'Create an objective. kind: okr | personal_goal | project | custom. Progress is computed (auto_rollup from key results/tasks/features by default).',
      inputSchema: objectiveCreateSchema,
      handler: (args) => {
        const input = objectiveCreateSchema.parse(args)
        const objective = objectiveStore.create(input)
        notify.broadcast('objective:updated', objective)
        return ok({ objective })
      },
    },
    {
      name: 'objective_update',
      title: 'Update objective',
      description: 'Update fields of an existing objective by id. Only provided fields change.',
      inputSchema: objectiveUpdateSchema,
      handler: (args) => {
        const input = objectiveUpdateSchema.parse(args)
        const objective = objectiveStore.update(input)
        notify.broadcast('objective:updated', objective)
        return ok({ objective })
      },
    },
    {
      name: 'objective_archive',
      title: 'Archive objective',
      description: 'Archive an objective (reversible soft-delete; it leaves active listings).',
      inputSchema: idSchema,
      handler: (args) => {
        const { id } = idSchema.parse(args)
        objectiveStore.archive(id)
        notify.broadcast('objective:updated', { id, archived: true })
        return ok({ id, archived: true })
      },
    },
    {
      name: 'key_result_create',
      title: 'Create key result',
      description: 'Create a key result under an objective (objectiveId required).',
      inputSchema: keyResultCreateSchema,
      handler: (args) => {
        const input = keyResultCreateSchema.parse(args)
        const keyResult = objectiveStore.createKeyResult(input)
        notify.broadcast('objective:updated', {
          id: keyResult.objectiveId,
          keyResultId: keyResult.id,
        })
        return ok({ keyResult })
      },
    },
    {
      name: 'key_result_update',
      title: 'Update key result',
      description: 'Update fields of an existing key result by id. Only provided fields change.',
      inputSchema: keyResultUpdateSchema,
      handler: (args) => {
        const input = keyResultUpdateSchema.parse(args)
        const keyResult = objectiveStore.updateKeyResult(input)
        notify.broadcast('objective:updated', {
          id: keyResult.objectiveId,
          keyResultId: keyResult.id,
        })
        return ok({ keyResult })
      },
    },
  ]
}

// ---- tasks ----

const taskStatus = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
const taskParentType = z.enum(['objective', 'key_result', 'feature'])

const taskLinkSchema = z.object({
  parentType: taskParentType,
  parentId: z.string().min(1),
})

// Espelha TaskListFilter.
const taskListSchema = z.object({
  status: taskStatus.optional(),
  priority: priority.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  parentType: taskParentType.optional(),
  parentId: z.string().optional(),
})

// Espelha CreateTaskInput.
const taskCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  status: taskStatus.optional(),
  priority: priority.nullish(),
  dueDate: z.number().nullish(),
  tags: z.array(z.string()).optional(),
  notes: z.string().nullish(),
  position: z.number().optional(),
  links: z.array(taskLinkSchema).optional(),
})

// Espelha UpdateTaskInput (sem links — vínculos mudam via task_set_links).
const taskUpdateSchema = taskCreateSchema
  .partial()
  .omit({ links: true })
  .extend({ id: z.string().min(1) })

const taskSetLinksSchema = z.object({
  taskId: z.string().min(1),
  links: z.array(taskLinkSchema),
})

function taskTools(notify: McpNotify): ToolDef[] {
  return [
    {
      name: 'task_list',
      title: 'List tasks',
      description:
        'List tasks. Optional filters: status, priority, tag, free-text search, or parent (parentType objective|key_result|feature + parentId).',
      inputSchema: taskListSchema,
      handler: (args) => {
        const filter = taskListSchema.parse(args)
        return ok({ items: taskStore.list(filter) })
      },
    },
    {
      name: 'task_create',
      title: 'Create task',
      description:
        'Create a task. Optional links attach it to objectives/key results/features (feeds auto-rollup progress).',
      inputSchema: taskCreateSchema,
      handler: (args) => {
        const input = taskCreateSchema.parse(args)
        const task = taskStore.create(input)
        notify.broadcast('task:updated', task)
        notify.affectedObjectives(task.links)
        return ok({ task })
      },
    },
    {
      name: 'task_update',
      title: 'Update task',
      description:
        'Update fields of an existing task by id (status, priority, dueDate, etc). Links are managed via task_set_links.',
      inputSchema: taskUpdateSchema,
      handler: (args) => {
        const input = taskUpdateSchema.parse(args)
        const task = taskStore.update(input)
        notify.broadcast('task:updated', task)
        notify.affectedObjectives(task.links)
        return ok({ task })
      },
    },
    {
      name: 'task_set_links',
      title: 'Set task links',
      description:
        'Replace the full set of parent links of a task (objective/key_result/feature). Pass an empty array to detach.',
      inputSchema: taskSetLinksSchema,
      handler: (args) => {
        const { taskId, links } = taskSetLinksSchema.parse(args)
        const previous = taskStore.setLinks(taskId, links)
        const task = taskStore.get(taskId)
        if (!task) throw new Error(`task not found: ${taskId}`)
        notify.broadcast('task:updated', task)
        // Notifica tanto quem ganhou quanto quem perdeu a tarefa.
        notify.affectedObjectives([...previous, ...links])
        return ok({ task })
      },
    },
  ]
}

// ---- features ----

const featureStatus = z.enum(['pending', 'in-progress', 'blocked', 'done', 'paused'])
const featureSynthMode = z.enum(['auto', 'manual', 'threshold'])
const featureOrigin = z.enum(['manual', 'auto'])
const featureLinkTargetType = z.enum(['objective', 'key_result'])

const featureRepoLinkSchema = z.object({
  repoId: z.string().min(1),
  branch: z.string().nullable().default(null),
  worktreePath: z.string().nullable().default(null),
})

const featureListSchema = z.object({ projectId: z.string().optional() })

// Espelha CreateFeatureInput.
const featureCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().nullish(),
  status: featureStatus.optional(),
  synthMode: featureSynthMode.optional(),
  model: z.string().nullish(),
  repos: z.array(featureRepoLinkSchema).optional(),
  origin: featureOrigin.optional(),
  overview: z.string().optional(),
  businessRules: z.string().optional(),
  approach: z.string().optional(),
})

// Espelha UpdateFeatureInput.
const featureUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  status: featureStatus.optional(),
  objective: z.string().nullish(),
  synthMode: featureSynthMode.optional(),
  model: z.string().nullish(),
})

const featureObjectiveLinkSchema = z.object({
  targetType: featureLinkTargetType,
  targetId: z.string().min(1),
})

const featureSetObjectiveLinksSchema = z.object({
  featureId: z.string().min(1),
  links: z.array(featureObjectiveLinkSchema),
})

function featureTools(notify: McpNotify): ToolDef[] {
  return [
    {
      name: 'feature_list',
      title: 'List features',
      description:
        'List features (index fields only, no markdown body). Optional projectId filter. Archived features and hidden auto-drafts are excluded.',
      inputSchema: featureListSchema,
      handler: (args) => {
        const { projectId } = featureListSchema.parse(args)
        return ok({ items: featureStore.list(projectId) })
      },
    },
    {
      name: 'feature_get',
      title: 'Get feature',
      description:
        'Get one feature by id including its markdown body. Returns { feature: null } when not found.',
      inputSchema: idSchema,
      handler: (args) => {
        const { id } = idSchema.parse(args)
        return ok({ feature: featureStore.get(id) })
      },
    },
    {
      name: 'feature_create',
      title: 'Create feature',
      description:
        'Create a feature in a project (writes its markdown doc). Optional seed sections: overview, businessRules, approach.',
      inputSchema: featureCreateSchema,
      handler: (args) => {
        const input = featureCreateSchema.parse(args)
        const feature = featureStore.create(input)
        notify.broadcast('feature:updated', feature)
        return ok({ feature })
      },
    },
    {
      name: 'feature_update',
      title: 'Update feature',
      description:
        'Update index fields of an existing feature by id (title, status, objective, synthMode, model).',
      inputSchema: featureUpdateSchema,
      handler: (args) => {
        const input = featureUpdateSchema.parse(args)
        const feature = featureStore.update(input)
        notify.broadcast('feature:updated', feature)
        return ok({ feature })
      },
    },
    {
      name: 'feature_archive',
      title: 'Archive feature',
      description: 'Archive a feature (reversible soft-delete; it leaves active listings).',
      inputSchema: idSchema,
      handler: (args) => {
        const { id } = idSchema.parse(args)
        featureStore.archive(id)
        notify.broadcast('feature:updated', { id, archived: true })
        return ok({ id, archived: true })
      },
    },
    {
      name: 'feature_set_objective_links',
      title: 'Set feature objective links',
      description:
        'Replace the full set of objective/key-result links of a feature (feeds auto-rollup progress). Pass an empty array to detach.',
      inputSchema: featureSetObjectiveLinksSchema,
      handler: (args) => {
        const { featureId, links } = featureSetObjectiveLinksSchema.parse(args)
        const previous = featureStore.setObjectiveLinks(featureId, links)
        const feature = featureStore.get(featureId)
        if (!feature) throw new Error(`feature not found: ${featureId}`)
        notify.broadcast('feature:updated', feature)
        // Notifica tanto os objetivos que ganharam quanto os que perderam a feature.
        notify.affectedObjectivesForFeatureLinks([...previous, ...links])
        return ok({ feature })
      },
    },
  ]
}

// ---- overview ----

const emptySchema = z.object({})

function overviewTools(): ToolDef[] {
  return [
    {
      name: 'overview_get',
      title: 'Get overview',
      description:
        'Aggregated dashboard snapshot: objective tree with progress, pending tasks (sorted), counts, and active features with session activity.',
      inputSchema: emptySchema,
      handler: (args) => {
        emptySchema.parse(args ?? {})
        return ok({ overview: overviewStore.getOverview() })
      },
    },
  ]
}

// ---- handoffs cross-repo ----

interface ResolvedRepo {
  id: string
  label: string
  path: string
  role: string | null
  projectId: string
  projectName: string
}

interface RepoLookupRow {
  id: string
  label: string
  path: string
  role: string | null
  project_id: string
  project_name: string
}

// Resolve um repo por label OU path (a mãe não conhece os ids internos). Lança
// erros legíveis (consumidos por outra sessão Claude): 0 → não encontrado;
// >1 → lista os candidatos pra a mãe desambiguar.
function resolveRepo(ref: string): ResolvedRepo {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.label, r.path, r.role, r.project_id, p.name AS project_name
         FROM repos r JOIN projects p ON p.id = r.project_id
        WHERE r.label = ? OR r.path = ?`,
    )
    .all(ref, ref) as RepoLookupRow[]
  if (rows.length === 0) throw new Error(`repo não encontrado: ${ref}`)
  if (rows.length > 1) {
    const candidates = rows
      .map((r) => `- label="${r.label}" path="${r.path}" project="${r.project_name}"`)
      .join('\n')
    throw new Error(
      `repo ambíguo: ${ref} corresponde a ${rows.length} repos. Desambigue pelo path exato:\n${candidates}`,
    )
  }
  const r = rows[0]
  return {
    id: r.id,
    label: r.label,
    path: r.path,
    role: r.role,
    projectId: r.project_id,
    projectName: r.project_name,
  }
}

// Resolve label+role de um repo por id (pra descrever a ponta oposta de uma aresta).
function repoBrief(id: string): { id: string; label: string; role: string | null } {
  const row = getDb()
    .prepare('SELECT id, label, role FROM repos WHERE id = ?')
    .get(id) as { id: string; label: string; role: string | null } | undefined
  if (!row) return { id, label: id, role: null }
  return row
}

const repoConnectionsGetSchema = z.object({ repo: z.string().min(1) })

const handoffMode = z.enum(['plan', 'auto-edits', 'interactive'])

const sessionHandoffSchema = z.object({
  targetRepo: z.string().min(1),
  task: z.string().min(1),
  fromRepo: z.string().min(1).optional(),
  featureId: z.string().min(1).optional(),
  context: z.string().optional(),
  // Modo de permissão da filha. 'plan' (read-only) p/ investigação; 'auto-edits'
  // (edita, com denylist destrutivo) p/ implementação; 'interactive' = pergunta
  // tudo (legado). Default: 'plan' (seguro). O humano confirma no gate.
  mode: handoffMode.optional(),
  // Cria mesmo havendo um handoff ativo pro mesmo repo-alvo (default: bloqueia
  // duplicado e devolve o existente).
  force: z.boolean().optional(),
})

const handoffResultSchema = z.object({ handoffId: z.string().min(1) })

const handoffListSchema = z.object({
  status: z
    .union([
      z.enum(['pending', 'approved', 'running', 'done', 'rejected', 'failed']),
      z.array(z.enum(['pending', 'approved', 'running', 'done', 'rejected', 'failed'])),
    ])
    .optional(),
})

const handoffReportSchema = z.object({
  handoffId: z.string().min(1),
  summary: z.string().min(1),
})

const handoffProgressSchema = z.object({
  handoffId: z.string().min(1),
  step: z.string().min(1),
})

// Default do teto de handoffs ativos (pending/approved/running) simultâneos por
// instância. Evita inundar o gate humano e estourar sessões-filhas concorrentes.
// Override via pref 'handoffs.maxActive'.
const DEFAULT_MAX_ACTIVE_HANDOFFS = 5

function handoffTools(notify: McpNotify): ToolDef[] {
  return [
    {
      name: 'repo_connections_get',
      title: 'Get repo connections',
      description:
        'Inspect a repo (by label or path) and its dependency-graph connections to other repos. Use before session_handoff to understand how the current repo relates to others.',
      inputSchema: repoConnectionsGetSchema,
      handler: (args) => {
        const { repo } = repoConnectionsGetSchema.parse(args)
        const r = resolveRepo(repo)
        const connections = repoDepStore.listByRepo(r.id).map((edge) => {
          const outgoing = edge.fromRepoId === r.id
          const otherId = outgoing ? edge.toRepoId : edge.fromRepoId
          return {
            id: edge.id,
            kind: edge.kind,
            label: edge.label,
            direction: (outgoing ? 'outgoing' : 'incoming') as 'outgoing' | 'incoming',
            otherRepo: repoBrief(otherId),
          }
        })
        return ok({
          repo: { id: r.id, label: r.label, path: r.path, role: r.role, project: r.projectName },
          connections,
        })
      },
    },
    {
      name: 'session_handoff',
      title: 'Hand off work to another repo',
      description:
        'Delegate end-to-end work to a connected repo by creating a handoff. Pass fromRepo = the repo you are working in (orients the context). Choose mode: "plan" (child is read-only — for investigation), "auto-edits" (child edits files autonomously, destructive commands blocked — for implementation), or "interactive" (asks for everything). Creates a pending handoff that requires human approval in the app, then spawns a child session in that mode. If an active handoff to the same target already exists it returns that one (pass force=true to override). Returns a handoffId; poll handoff_result(handoffId) until status=done, then synthesize the summary.',
      inputSchema: sessionHandoffSchema,
      handler: (args) => {
        const input = sessionHandoffSchema.parse(args)

        // Reconcilia órfãos ANTES de contar: filhas mortas/crashadas não devem
        // inflar a contagem e travar o teto com falsos-ativos.
        handoffStore.reconcileStuck()

        // Cap de concorrência: não acumula handoffs ativos além do teto.
        const maxActive = getPref('handoffs.maxActive', DEFAULT_MAX_ACTIVE_HANDOFFS)
        const activeHandoffs = handoffStore.list({ status: ['pending', 'approved', 'running'] })
        if (activeHandoffs.length >= maxActive) {
          // Mensagem honesta: breakdown REAL por status. Sem pendentes a resolver,
          // não mandar "resolver pendentes" — os bloqueadores estão em andamento.
          const pending = activeHandoffs.filter(
            (h) => h.status === 'pending' || h.status === 'approved',
          )
          const running = activeHandoffs.filter((h) => h.status === 'running')
          const fmt = (h: (typeof activeHandoffs)[number]): string =>
            `${h.targetRepoLabel ?? h.targetRepoId} (${h.id})`
          let error: string
          if (pending.length === 0 && running.length > 0) {
            error = `Limite de ${maxActive} handoffs ativos atingido — ${running.length} em andamento (targets: ${running.map(fmt).join(', ')}). Acompanhe/destrave no painel Handoffs ou aguarde concluírem antes de criar outro.`
          } else {
            const parts: string[] = []
            if (pending.length > 0)
              parts.push(`${pending.length} pendente(s) de aprovação (${pending.map(fmt).join(', ')})`)
            if (running.length > 0)
              parts.push(`${running.length} em andamento (${running.map(fmt).join(', ')})`)
            error = `Limite de ${maxActive} handoffs ativos atingido — ${parts.join('; ')}. Aprove/rejeite os pendentes ou aguarde os em andamento concluírem no painel Handoffs antes de criar outro.`
          }
          return ok({ error })
        }

        const target = resolveRepo(input.targetRepo)
        const from = input.fromRepo ? resolveRepo(input.fromRepo) : null

        // Dedup por alvo: evita dois agentes mutando o mesmo repo em paralelo
        // (causa-raiz de quase-acidente). Devolve o handoff existente em vez de
        // criar duplicado, salvo force=true.
        if (!input.force) {
          const existing = handoffStore.findActiveByTarget(target.id)
          if (existing) {
            return ok({
              handoffId: existing.id,
              status: existing.status,
              duplicate: true,
              message: `Já existe um handoff ativo (${existing.status}) para ${target.label}. Faça polling com handoff_result("${existing.id}") ou passe force=true para criar outro mesmo assim.`,
            })
          }
        }

        // Arestas do target → shape do compose, orientadas pela MÃE (fromRepo).
        // Prioriza as que tocam o fromRepo; se não há fromRepo, ainda inclui as
        // do target com uma direção plausível.
        const allEdges = repoDepStore.listByRepo(target.id)
        const toCompose = (edge: RepoDependency): HandoffEdge => {
          const targetIsFrom = edge.fromRepoId === target.id
          return {
            kind: edge.kind,
            label: edge.label,
            // from-mother: mãe → target (aresta entra no target).
            // to-mother:   target → mãe (aresta sai do target).
            direction: targetIsFrom ? 'to-mother' : 'from-mother',
          }
        }
        const edges: HandoffEdge[] = from
          ? allEdges
              .filter(
                (e) => e.fromRepoId === from.id || e.toRepoId === from.id,
              )
              .map(toCompose)
          : allEdges.map(toCompose)

        const featureTitle = input.featureId
          ? (
              getDb()
                .prepare('SELECT title FROM features WHERE id = ?')
                .get(input.featureId) as { title: string } | undefined
            )?.title ?? null
          : null

        const handoffId = randomUUID()
        const composed = composeHandoffPrompt({
          targetRepoLabel: target.label,
          targetRepoPath: target.path,
          motherRepoLabel: from?.label,
          task: input.task,
          edges,
          featureTitle,
          handoffId,
          mode: input.mode ?? 'plan',
        })

        const handoff = handoffStore.create({
          id: handoffId,
          motherSessionId: null,
          targetRepoId: target.id,
          featureId: input.featureId ?? null,
          task: input.task,
          contextJson: input.context ?? null,
          composedPrompt: composed,
          mode: input.mode ?? 'plan',
        })
        notify.broadcast('handoff:updated', handoff)
        return ok({
          handoffId,
          status: 'pending',
          message:
            'Handoff criado e aguardando aprovação humana no app. Faça polling com handoff_result(handoffId) — quando status=done, leia o summary.',
        })
      },
    },
    {
      name: 'handoff_result',
      title: 'Poll handoff result',
      description:
        'Poll a handoff by id. Returns { status, currentStep, stepUpdatedAt, summary, error }. While running, currentStep shows the child’s latest progress (set via handoff_progress). Keep polling until status=done (then read summary) or rejected/failed.',
      inputSchema: handoffResultSchema,
      handler: (args) => {
        const { handoffId } = handoffResultSchema.parse(args)
        const handoff = handoffStore.get(handoffId)
        if (!handoff) throw new Error(`handoff não encontrado: ${handoffId}`)
        return ok({
          status: handoff.status,
          currentStep: handoff.currentStep,
          stepUpdatedAt: handoff.stepUpdatedAt,
          summary: handoff.summary,
          error: handoff.error,
        })
      },
    },
    {
      name: 'handoff_list',
      title: 'List handoffs',
      description:
        'List handoffs (optionally filtered by status), most recent first. Returns { handoffId, targetRepo, status, mode, currentStep, task }. Use to recover a lost handoffId or to see active work per repo before delegating again.',
      inputSchema: handoffListSchema,
      handler: (args) => {
        const { status } = handoffListSchema.parse(args)
        const items = handoffStore.list(status ? { status } : undefined).map((h) => ({
          handoffId: h.id,
          targetRepo: h.targetRepoLabel,
          status: h.status,
          mode: h.mode,
          currentStep: h.currentStep,
          task: h.task,
        }))
        return ok({ items })
      },
    },
    {
      name: 'handoff_progress',
      title: 'Report handoff progress',
      description:
        'Called by the CHILD session to report a NON-TERMINAL progress step (does NOT mark done). Use this throughout the work so the mother’s polls are informative. Only handoff_report marks the work done.',
      inputSchema: handoffProgressSchema,
      handler: (args) => {
        const { handoffId, step } = handoffProgressSchema.parse(args)
        const existing = handoffStore.get(handoffId)
        if (!existing) throw new Error(`handoff não encontrado: ${handoffId}`)
        const updated = handoffStore.progress(handoffId, step)
        notify.broadcast('handoff:updated', updated)
        return ok({ status: updated.status, currentStep: updated.currentStep })
      },
    },
    {
      name: 'handoff_report',
      title: 'Report handoff result',
      description:
        'Called by the CHILD session ONLY when the handed-off work is fully complete AND verified (tests/typecheck pass). Records the summary and marks the handoff done. Do NOT call this before the work is actually finished — use handoff_progress for interim updates.',
      inputSchema: handoffReportSchema,
      handler: (args) => {
        const { handoffId, summary } = handoffReportSchema.parse(args)
        const existing = handoffStore.get(handoffId)
        if (!existing) throw new Error(`handoff não encontrado: ${handoffId}`)
        const updated = handoffStore.report(handoffId, summary)
        notify.broadcast('handoff:updated', updated)
        return ok({ status: 'done' })
      },
    },
  ]
}

export function buildTools(notify: McpNotify): ToolDef[] {
  return [
    ...overviewTools(),
    ...objectiveTools(notify),
    ...taskTools(notify),
    ...featureTools(notify),
    ...handoffTools(notify),
  ]
}

export function registerTools(server: McpServer, notify: McpNotify): void {
  for (const tool of buildTools(notify)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      (args: unknown) => tool.handler(args),
    )
  }
}
