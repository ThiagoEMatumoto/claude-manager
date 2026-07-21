import { ipcMain } from 'electron'
import { z } from 'zod'
import * as store from '../services/dossier-store'
import { broadcast } from '../services/notify'
import { getDossierPipeline, isWebSearchEnabled } from '../services/dossier-pipeline-singleton'
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

// Para falhas de estágio (extract/verify/synth via claude -p) a pipeline já
// persiste status:'failed' + error antes de relançar (ver dossier-pipeline.ts).
// Aqui absorvemos ESSA rejeição especificamente e devolvemos a run já
// atualizada — assim o caller (renderer) recebe uma promise resolvida e
// dispara o refresh normal, exercendo o branch de UI que já existe pra
// status 'failed'. Outras rejeições (ex.: throttle de fetch, run inexistente)
// não deixam a run em 'failed' — nesses casos relançamos, preservando o
// comportamento anterior (promise rejeitada).
async function runPipelineStep(
  runId: string,
  action: () => Promise<DossierRun>,
): Promise<DossierRun> {
  try {
    return broadcastRun(await action())
  } catch (err) {
    const run = store.getRun(runId)
    if (!run || run.status !== 'failed') throw err
    return broadcastRun(run)
  }
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
    return runPipelineStep(runId, () => getDossierPipeline().approveGateA(runId, plan))
  })

  ipcMain.handle('dossiers:approveGateB', async (_e, raw: unknown): Promise<DossierRun> => {
    const { runId, keepEvidenceIds } = approveGateBSchema.parse(raw)
    return runPipelineStep(runId, () => getDossierPipeline().approveGateB(runId, keepEvidenceIds))
  })

  ipcMain.handle('dossiers:resumeRun', async (_e, raw: unknown): Promise<DossierRun> => {
    const { runId } = resumeRunSchema.parse(raw)
    return runPipelineStep(runId, () => getDossierPipeline().resumeRun(runId))
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

  ipcMain.handle('dossiers:isWebSearchEnabled', (): boolean => {
    return isWebSearchEnabled()
  })
}
