import { ipcMain } from 'electron'
import { z } from 'zod'
import * as store from '../services/dossier-store'
import { broadcast } from '../services/notify'
import { getDossierPipeline } from '../services/dossier-pipeline-singleton'
import type {
  Dossier,
  DossierRun,
  EvidenceRecord,
  Source,
} from '../../../shared/types/ipc'

// As 7 classes de fonte (espelha o union SourceClass de shared/types/ipc).
const sourceClass = z.enum([
  'primary_official',
  'academic',
  'reputable_press',
  'practitioner_video',
  'forum_ugc',
  'vendor_marketing',
  'blog_seo',
])

const createSchema = z.object({
  title: z.string().min(1),
  question: z.string().min(1),
  sourceClasses: z.array(sourceClass).min(1),
  budgetTokens: z.number().int().positive().nullable().optional(),
})

const listSchema = z
  .object({
    status: z.enum(['active', 'archived']).optional(),
  })
  .optional()

const startRunSchema = z.object({
  dossierId: z.string().min(1),
})

const approveGateASchema = z.object({
  runId: z.string().min(1),
  // O plano editado é opcional; quando ausente, o pipeline usa o plan_json persistido.
  plan: z
    .object({
      question: z.string(),
      subQuestions: z.array(z.string()),
      sourceClasses: z.array(sourceClass),
    })
    .optional(),
})

const approveGateBSchema = z.object({
  runId: z.string().min(1),
  // Ids da evidência a MANTER (poda no Gate B). Ausente = mantém tudo.
  keepEvidenceIds: z.array(z.string()).optional(),
})

const resumeRunSchema = z.object({
  runId: z.string().min(1),
})

// Toda mutação de run rebroadcasta o dossiê e a run atualizada — a UI recarrega
// pelos mesmos canais (molde handoffs: broadcast('handoff:updated', ...)).
function broadcastRun(run: DossierRun): DossierRun {
  broadcast('dossier:run-updated', run)
  return run
}

export function registerDossiersIpc(): void {
  // ---- dossiers (entidade persistente) ----

  ipcMain.handle('dossiers:create', (_e, raw: unknown): Dossier => {
    const input = createSchema.parse(raw)
    const dossier = store.createDossier({
      title: input.title,
      question: input.question,
      sourceClasses: input.sourceClasses,
      budgetTokens: input.budgetTokens ?? null,
    })
    broadcast('dossier:updated', dossier)
    return dossier
  })

  ipcMain.handle('dossiers:list', (_e, raw: unknown): Dossier[] => {
    const opts = listSchema.parse(raw)
    return store.listDossiers(opts)
  })

  ipcMain.handle('dossiers:get', (_e, id: string): Dossier | null => {
    return store.getDossier(id)
  })

  ipcMain.handle('dossiers:archive', (_e, id: string): Dossier => {
    const dossier = store.archiveDossier(id)
    broadcast('dossier:updated', dossier)
    return dossier
  })

  // ---- runs (cada execução do funil) ----

  ipcMain.handle('dossiers:startRun', async (_e, raw: unknown): Promise<DossierRun> => {
    const { dossierId } = startRunSchema.parse(raw)
    const run = await getDossierPipeline().startRun(dossierId)
    return broadcastRun(run)
  })

  ipcMain.handle('dossiers:approveGateA', async (_e, raw: unknown): Promise<DossierRun> => {
    const { runId, plan } = approveGateASchema.parse(raw)
    const run = await getDossierPipeline().approveGateA(runId, plan)
    return broadcastRun(run)
  })

  ipcMain.handle('dossiers:approveGateB', async (_e, raw: unknown): Promise<DossierRun> => {
    const { runId, keepEvidenceIds } = approveGateBSchema.parse(raw)
    const run = await getDossierPipeline().approveGateB(runId, keepEvidenceIds)
    return broadcastRun(run)
  })

  ipcMain.handle('dossiers:resumeRun', async (_e, raw: unknown): Promise<DossierRun> => {
    const { runId } = resumeRunSchema.parse(raw)
    const run = await getDossierPipeline().resumeRun(runId)
    return broadcastRun(run)
  })

  // ---- leituras (vão direto ao store) ----

  ipcMain.handle('dossiers:listRuns', (_e, dossierId: string): DossierRun[] => {
    return store.listRuns(dossierId)
  })

  ipcMain.handle('dossiers:getRun', (_e, runId: string): DossierRun | null => {
    return store.getRun(runId)
  })

  ipcMain.handle('dossiers:listEvidence', (_e, runId: string): EvidenceRecord[] => {
    return store.listEvidence(runId)
  })

  ipcMain.handle('dossiers:listSources', (_e, runId: string): Source[] => {
    return store.listSources(runId)
  })
}
