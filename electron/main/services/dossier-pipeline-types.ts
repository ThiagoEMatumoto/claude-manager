import type { EvidenceState, SourceClass, TrustTier } from '../../../shared/types/ipc'

// Interfaces pluggáveis do funil. Os stubs determinísticos vivem em
// `dossier-pipeline-stubs.ts`; os provedores reais (web/vídeo/acadêmico) entram
// nas fatias seguintes implementando estas mesmas formas.

export interface Snippet {
  url: string
  title?: string
  publisher?: string
  sourceClass: SourceClass
  snippet: string
}

export interface DocumentSegment {
  // Âncora textual ("char:123") ou timestamp ("12:34") — proveniência verbatim.
  anchor: string
  text: string
}

export interface FetchedDocument {
  url: string
  title?: string
  text: string
  segments?: DocumentSegment[]
}

export interface SearchOpts {
  // Teto de snippets por query; o provedor pode devolver menos.
  limit?: number
}

export interface SourceProvider {
  search(query: string, opts?: SearchOpts): Promise<Snippet[]>
  fetch(url: string): Promise<FetchedDocument>
}

export interface ExtractedClaim {
  claim: string
  // Substring REAL de `doc.text` — nunca fabricada.
  verbatimQuote: string
  // Offset de char da substring (texto) ou timestamp (vídeo). Opcional.
  anchor?: string
  importance: number
}

export interface Extractor {
  extract(doc: FetchedDocument, sourceId: string): Promise<ExtractedClaim[]>
}

// Claim candidato à verificação. O lote inteiro vai junto porque corroboração e
// contradição são relações ENTRE claims de fontes distintas — não dá pra julgar
// um record isolado.
export interface VerifyCandidate {
  id: string
  claim: string
  verbatimQuote: string
  sourceId: string
  trustTier: TrustTier
}

export interface VerifyVerdict {
  state: EvidenceState
  // Ids de outros candidatos do MESMO lote (nunca da mesma fonte).
  corroboratedBy: string[]
  contradictedBy: string[]
}

export interface Verifier {
  // Julga o lote de uma vez e devolve o veredito por id de candidato.
  verify(candidates: readonly VerifyCandidate[]): Promise<Map<string, VerifyVerdict>>
}

// Roteamento por confiança da fonte + relações encontradas (regra de produto,
// compartilhada pelos verifiers). Contradição vence: um claim disputado é
// 'contested' mesmo vindo de fonte primária.
export function routeEvidenceState(
  trustTier: TrustTier,
  corroboratedBy: readonly string[],
  contradictedBy: readonly string[],
): EvidenceState {
  if (contradictedBy.length > 0) return 'contested'
  if (trustTier === 'high') return 'primary_accepted'
  if (corroboratedBy.length > 0) return 'corroborated'
  return 'single_source'
}

// Registro mínimo que a síntese consome (independe do shape de persistência).
export interface SynthRecord {
  // Id do EvidenceRecord — é ele que a síntese cita (proveniência rastreável).
  id: string
  claim: string
  verbatimQuote: string
  state: EvidenceState
  sourceClass: SourceClass
}

export interface Synthesizer {
  synthesize(records: readonly SynthRecord[]): Promise<string>
}

export interface DossierPipelineDeps {
  sourceProvider: SourceProvider
  extractor: Extractor
  verifier: Verifier
  synthesizer: Synthesizer
  // Cap de chamadas concorrentes em fetch/extract/verify. Default 6.
  concurrency?: number
}

// Plano do estágio 0 (persistido em `plan_json`).
export interface DossierPlan {
  question: string
  subQuestions: string[]
  sourceClasses: SourceClass[]
}

// Estágios internos concluídos, persistidos em `checkpoint_json` pra retomar sem
// re-pagar. A ordem reflete o avanço do funil.
export type PipelineStage =
  | 'planning'
  | 'searching'
  | 'fetching'
  | 'extracting'
  | 'verifying'
  | 'synthesizing'

export interface PipelineCheckpoint {
  completedStages: PipelineStage[]
}

// Mapa classe → trust tier (regra de produto: deriva confiança da classe da fonte).
export const TRUST_TIER_BY_CLASS: Record<SourceClass, TrustTier> = {
  primary_official: 'high',
  academic: 'high',
  reputable_press: 'medium',
  practitioner_video: 'medium',
  forum_ugc: 'low',
  blog_seo: 'low',
  vendor_marketing: 'biased',
}

export function trustTierForClass(sourceClass: SourceClass): TrustTier {
  return TRUST_TIER_BY_CLASS[sourceClass]
}
