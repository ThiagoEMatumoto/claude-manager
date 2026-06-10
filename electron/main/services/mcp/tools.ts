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
import type { FeatureObjectiveLink, TaskLink } from '../../../../shared/types/ipc'

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

export function buildTools(notify: McpNotify): ToolDef[] {
  return [
    ...overviewTools(),
    ...objectiveTools(notify),
    ...taskTools(notify),
    ...featureTools(notify),
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
