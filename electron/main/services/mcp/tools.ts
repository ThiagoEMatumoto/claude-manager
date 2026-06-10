// Tools MCP — handlers finos: validação zod → store → notify → retorno.
// Sem lógica de negócio própria; os broadcasts espelham 1:1 o que a camada IPC
// emite (mesmos canais/payloads), então a UI atualiza ao vivo pra writes MCP.
// Sem deletes destrutivos: archive (reversível) é o máximo de remoção exposto.
import * as z from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/server'
import * as objectiveStore from '../objective-store'
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

export function buildTools(notify: McpNotify): ToolDef[] {
  return [...objectiveTools(notify)]
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
