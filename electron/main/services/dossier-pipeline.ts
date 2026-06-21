import type { DossierRun, EvidenceRecord, Source } from '../../../shared/types/ipc'
import { mapWithConcurrency } from './concurrency'
import * as store from './dossier-store'
import {
  type DossierPipelineDeps,
  type DossierPlan,
  type FetchedDocument,
  type PipelineCheckpoint,
  type PipelineStage,
  type SynthRecord,
  trustTierForClass,
} from './dossier-pipeline-types'

// Teto de páginas baixadas no estágio de fetch (top-K + alta-confiança). Mantém o
// fetch sob demanda em vez de baixar tudo.
const DEFAULT_FETCH_TOP_K = 3
const DEFAULT_CONCURRENCY = 6

// Status que só são alcançados DEPOIS do Gate B humano. Um resume que encontra a
// run num destes deve completar verify/synth; caso contrário, parar no Gate B.
const GATE_B_APPROVED_STATUSES: ReadonlySet<DossierRun['status']> = new Set([
  'verifying',
  'synthesizing',
  'done',
])

function parseCheckpoint(run: DossierRun): PipelineCheckpoint {
  if (!run.checkpointJson) return { completedStages: [] }
  try {
    const parsed = JSON.parse(run.checkpointJson) as PipelineCheckpoint
    return { completedStages: parsed.completedStages ?? [] }
  } catch {
    return { completedStages: [] }
  }
}

function hasCompleted(checkpoint: PipelineCheckpoint, stage: PipelineStage): boolean {
  return checkpoint.completedStages.includes(stage)
}

// Motor do funil de dossiê. Orquestra os estágios internos com cap de concorrência
// e checkpoint após cada estágio, parando nos dois gates humanos (A e B). Sem web
// real: a ingestão vem dos provedores injetados (stubs nesta fatia).
export class DossierPipeline {
  private readonly sourceProvider: DossierPipelineDeps['sourceProvider']
  private readonly extractor: DossierPipelineDeps['extractor']
  private readonly verifier: DossierPipelineDeps['verifier']
  private readonly synthesizer: DossierPipelineDeps['synthesizer']
  private readonly concurrency: number
  private readonly fetchTopK: number
  // Docs baixados no estágio de fetch, reusados pela extração na MESMA execução
  // pra não re-pagar fetch. Vazio após um restart → extract re-busca (correto).
  private readonly docCache = new Map<string, FetchedDocument>()

  constructor(
    private readonly storeApi: typeof store,
    deps: DossierPipelineDeps & { fetchTopK?: number },
  ) {
    this.sourceProvider = deps.sourceProvider
    this.extractor = deps.extractor
    this.verifier = deps.verifier
    this.synthesizer = deps.synthesizer
    this.concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
    this.fetchTopK = deps.fetchTopK ?? DEFAULT_FETCH_TOP_K
  }

  // Estágio 0: cria a run, monta o plano (sub-perguntas + classes do dossiê),
  // persiste plan_json e PARA em awaiting_gate_a sem prosseguir.
  async startRun(dossierId: string): Promise<DossierRun> {
    const dossier = this.storeApi.getDossier(dossierId)
    if (!dossier) throw new Error(`dossier not found: ${dossierId}`)

    const run = this.storeApi.createRun({ dossierId, status: 'planning', stage: 'planning' })

    const plan: DossierPlan = {
      question: dossier.question,
      subQuestions: this.buildSubQuestions(dossier.question),
      sourceClasses: dossier.sourceClasses,
    }

    this.storeApi.updateRun(run.id, { planJson: JSON.stringify(plan) })
    return this.commitStage(run.id, 'planning', {
      status: 'awaiting_gate_a',
      stage: 'awaiting_gate_a',
    })
  }

  // Gate A aprovado: busca → fetch top-K → extração. Persiste sources e evidence
  // records, depois PARA em awaiting_gate_b.
  async approveGateA(runId: string, plan?: DossierPlan): Promise<DossierRun> {
    const run = this.requireRun(runId)
    const effectivePlan = plan ?? this.loadPlan(run)
    if (plan) this.storeApi.updateRun(runId, { planJson: JSON.stringify(plan) })

    await this.runSearch(runId, effectivePlan)
    await this.runFetch(runId)
    await this.runExtract(runId)

    return this.storeApi.updateRun(runId, {
      status: 'awaiting_gate_b',
      stage: 'awaiting_gate_b',
    })
  }

  // Gate B aprovado: poda opcional → verificação roteada → síntese graduada.
  // Termina em done com finished_at.
  async approveGateB(runId: string, keepEvidenceIds?: string[]): Promise<DossierRun> {
    this.requireRun(runId)
    if (keepEvidenceIds) this.pruneEvidence(runId, keepEvidenceIds)

    await this.runVerify(runId)
    await this.runSynthesize(runId)

    return this.requireRun(runId)
  }

  // Retoma uma run parada no meio (ex.: throttle no fetch) a partir do checkpoint,
  // sem refazer os estágios já concluídos. Respeita os dois gates como barreiras:
  // se o break foi ANTES do Gate B (status nunca passou de awaiting_gate_b), o
  // resume para de novo no Gate B; se foi DEPOIS (verify/synth em curso), completa.
  async resumeRun(runId: string): Promise<DossierRun> {
    const run = this.requireRun(runId)
    const checkpoint = parseCheckpoint(run)
    const plan = this.loadPlan(run)
    const gateBApproved = GATE_B_APPROVED_STATUSES.has(run.status)

    if (!hasCompleted(checkpoint, 'searching')) await this.runSearch(runId, plan)
    if (!hasCompleted(checkpoint, 'fetching')) await this.runFetch(runId)
    if (!hasCompleted(checkpoint, 'extracting')) await this.runExtract(runId)

    if (!gateBApproved) {
      return this.storeApi.updateRun(runId, {
        status: 'awaiting_gate_b',
        stage: 'awaiting_gate_b',
      })
    }

    if (!hasCompleted(parseCheckpoint(this.requireRun(runId)), 'verifying'))
      await this.runVerify(runId)
    if (!hasCompleted(parseCheckpoint(this.requireRun(runId)), 'synthesizing'))
      await this.runSynthesize(runId)

    return this.requireRun(runId)
  }

  // ---- estágios internos ----

  private async runSearch(runId: string, plan: DossierPlan): Promise<void> {
    this.storeApi.updateRun(runId, { status: 'searching', stage: 'searching' })
    // Uma busca por sub-pergunta; persiste cada snippet como source 'snippet'.
    for (const query of plan.subQuestions) {
      const snippets = await this.sourceProvider.search(query)
      for (const snippet of snippets) {
        this.storeApi.addSource({
          dossierRunId: runId,
          url: snippet.url,
          title: snippet.title ?? null,
          publisher: snippet.publisher ?? null,
          sourceClass: snippet.sourceClass,
          trustTier: trustTierForClass(snippet.sourceClass),
          status: 'snippet',
        })
      }
    }
    this.commitStage(runId, 'searching')
  }

  private async runFetch(runId: string): Promise<void> {
    this.storeApi.updateRun(runId, { status: 'fetching', stage: 'fetching' })
    const snippets = this.storeApi
      .listSources(runId)
      .filter((s) => s.status === 'snippet')
    const top = this.pickTopK(snippets)

    await mapWithConcurrency(top, this.concurrency, async (source) => {
      const doc = await this.sourceProvider.fetch(source.url)
      this.docCache.set(source.id, doc)
      this.storeApi.updateSource(source.id, {
        title: doc.title ?? source.title,
        retrievedAt: Date.now(),
        contentRef: doc.url,
        status: 'fetched',
      })
    })
    this.commitStage(runId, 'fetching')
  }

  private async runExtract(runId: string): Promise<void> {
    this.storeApi.updateRun(runId, { status: 'extracting', stage: 'extracting' })
    const fetched = this.storeApi.listSources(runId).filter((s) => s.status === 'fetched')

    await mapWithConcurrency(fetched, this.concurrency, async (source) => {
      const doc = this.docCache.get(source.id) ?? (await this.sourceProvider.fetch(source.url))
      const claims = await this.extractor.extract(doc, source.id)
      for (const claim of claims) {
        this.storeApi.addEvidence({
          dossierRunId: runId,
          sourceId: source.id,
          claim: claim.claim,
          verbatimQuote: claim.verbatimQuote,
          anchor: claim.anchor ?? null,
          state: 'unverified',
          importance: claim.importance,
        })
      }
    })
    this.commitStage(runId, 'extracting')
  }

  private async runVerify(runId: string): Promise<void> {
    this.storeApi.updateRun(runId, { status: 'verifying', stage: 'verifying' })
    const records = this.storeApi.listEvidence(runId)
    const sourcesById = this.indexSources(runId)

    await mapWithConcurrency(records, this.concurrency, async (record) => {
      const source = sourcesById.get(record.sourceId)
      if (!source) throw new Error(`evidence ${record.id} references missing source`)
      const corroborating = this.countCorroborating(record, records, sourcesById)
      const state = await this.verifier.verify(record.claim, source.trustTier, corroborating)
      this.storeApi.updateEvidenceState(record.id, state)
    })
    this.commitStage(runId, 'verifying')
  }

  private async runSynthesize(runId: string): Promise<void> {
    this.storeApi.updateRun(runId, { status: 'synthesizing', stage: 'synthesizing' })
    const records = this.storeApi.listEvidence(runId)
    const sourcesById = this.indexSources(runId)

    const synthRecords: SynthRecord[] = records.map((r) => {
      const source = sourcesById.get(r.sourceId)
      if (!source) throw new Error(`evidence ${r.id} references missing source`)
      return {
        claim: r.claim,
        verbatimQuote: r.verbatimQuote,
        state: r.state,
        sourceClass: source.sourceClass,
      }
    })

    const summary = await this.synthesizer.synthesize(synthRecords)
    // Grava o checkpoint de 'synthesizing' concluído, depois finaliza via updateRun
    // (que carimba finished_at ao entrar no estado terminal 'done').
    this.commitStage(runId, 'synthesizing')
    this.storeApi.updateRun(runId, { summary, status: 'done', stage: 'done' })
  }

  // ---- helpers ----

  // Conta records corroborantes: outros records de fonte NÃO-enviesada e de fonte
  // distinta. >=1 sinaliza confirmação independente (regra de produto).
  private countCorroborating(
    record: EvidenceRecord,
    all: readonly EvidenceRecord[],
    sourcesById: Map<string, Source>,
  ): number {
    let count = 0
    for (const other of all) {
      if (other.id === record.id) continue
      if (other.sourceId === record.sourceId) continue
      const otherSource = sourcesById.get(other.sourceId)
      if (otherSource && otherSource.trustTier !== 'biased') count++
    }
    return count
  }

  private indexSources(runId: string): Map<string, Source> {
    const map = new Map<string, Source>()
    for (const s of this.storeApi.listSources(runId)) map.set(s.id, s)
    return map
  }

  // top-K: prioriza alta-confiança (high > medium > low > biased), depois ordem
  // de chegada. Cap o fetch em fetchTopK pra não baixar página em massa.
  private pickTopK(sources: readonly Source[]): Source[] {
    const tierRank: Record<string, number> = { high: 0, medium: 1, low: 2, biased: 3 }
    return [...sources]
      .sort((a, b) => (tierRank[a.trustTier] ?? 9) - (tierRank[b.trustTier] ?? 9))
      .slice(0, this.fetchTopK)
  }

  private pruneEvidence(runId: string, keepIds: string[]): void {
    const keep = new Set(keepIds)
    for (const record of this.storeApi.listEvidence(runId)) {
      if (!keep.has(record.id)) this.storeApi.deleteEvidence(record.id)
    }
  }

  private buildSubQuestions(question: string): string[] {
    // Decomposição mínima determinística (1 query); o planner real (Haiku) entra
    // depois e pode expandir em várias sub-perguntas.
    return [question]
  }

  private loadPlan(run: DossierRun): DossierPlan {
    if (!run.planJson) throw new Error(`run ${run.id} has no plan; cannot proceed`)
    return JSON.parse(run.planJson) as DossierPlan
  }

  private requireRun(runId: string): DossierRun {
    const run = this.storeApi.getRun(runId)
    if (!run) throw new Error(`dossier run not found: ${runId}`)
    return run
  }

  // Grava o checkpoint (estágio concluído) e opcionalmente avança status/stage.
  private commitStage(
    runId: string,
    stage: PipelineStage,
    advance?: { status?: DossierRun['status']; stage?: string | null },
  ): DossierRun {
    const run = this.requireRun(runId)
    const checkpoint = parseCheckpoint(run)
    if (!checkpoint.completedStages.includes(stage)) checkpoint.completedStages.push(stage)
    return this.storeApi.checkpointRun(runId, JSON.stringify(checkpoint), {
      status: advance?.status,
      stage: advance?.stage,
    })
  }
}
