import * as z from 'zod/v4'
import { runClaude, type RunResult } from '../claude-cli'
import { extractJsonBlock, isGrounded } from '../meeting-extraction'
import type {
  ExtractedClaim,
  Extractor,
  FetchedDocument,
} from '../dossier-pipeline-types'
import {
  composeDossierExtractionPrompt,
  type PromptDocSegment,
} from './compose-extraction-prompt'

// Extractor real do funil de dossiê: documento buscado → claims com proveniência
// verbatim, via `claude -p` (text-mode) + parse tolerante a preâmbulo.
//
// Gate anti-alucinação: o `verbatim` de cada claim é validado contra o texto real
// do documento (mesma checagem de grounding da Meeting Intelligence). Claim que
// não casa é DESCARTADO — nunca corrigido. É isso que dá valor à proveniência.

const EXTRACTION_TIMEOUT_MS = 120_000

const claimSchema = z.object({
  claim: z.string().min(1),
  verbatim: z.string().min(1),
  anchor: z.string().nullish(),
  importance: z.number().nullish(),
})

const resultSchema = z.object({
  claims: z.array(claimSchema),
})

export type DossierExtractionPayload = z.infer<typeof resultSchema>

function parseAndValidate(stdout: string): DossierExtractionPayload {
  const block = extractJsonBlock(stdout)
  if (!block) throw new Error('nenhum bloco JSON encontrado na resposta do modelo')
  let raw: unknown
  try {
    raw = JSON.parse(block)
  } catch (err) {
    throw new Error(`JSON inválido: ${err instanceof Error ? err.message : String(err)}`)
  }
  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`schema inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  return parsed.data
}

function docSegments(doc: FetchedDocument): PromptDocSegment[] {
  if (doc.segments && doc.segments.length > 0) return doc.segments
  return [{ anchor: 'char:0', text: doc.text }]
}

// Âncora real: offset da substring exata em doc.text. O grounding é normalizado
// (tolera acento/caixa/espaço), então nem todo claim aprovado tem match exato —
// nesse caso fica a âncora que o modelo informou.
function resolveAnchor(doc: FetchedDocument, verbatim: string, modelAnchor?: string | null): string | null {
  const offset = doc.text.indexOf(verbatim)
  if (offset >= 0) return `char:${offset}`
  return modelAnchor?.trim() || null
}

function clampImportance(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export interface ClaudeExtractorOptions {
  runClaude?: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>
}

export class ClaudeExtractor implements Extractor {
  private readonly run: NonNullable<ClaudeExtractorOptions['runClaude']>

  constructor(options: ClaudeExtractorOptions = {}) {
    this.run = options.runClaude ?? runClaude
  }

  async extract(doc: FetchedDocument, _sourceId: string): Promise<ExtractedClaim[]> {
    const prompt = composeDossierExtractionPrompt({
      url: doc.url,
      title: doc.title,
      segments: docSegments(doc),
    })
    const payload = await this.generateWithRetry(prompt)

    const grounding = [{ text: doc.text }]
    const out: ExtractedClaim[] = []
    for (const claim of payload.claims) {
      if (!isGrounded(claim.verbatim, grounding)) continue
      out.push({
        claim: claim.claim,
        verbatimQuote: claim.verbatim,
        anchor: resolveAnchor(doc, claim.verbatim, claim.anchor) ?? undefined,
        importance: clampImportance(claim.importance),
      })
    }
    return out
  }

  private async generate(prompt: string): Promise<string> {
    const result = await this.run(['-p', prompt, '--output-format', 'text'], {
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    })
    if (result.code !== 0) {
      throw new Error(`claude -p falhou (exit ${result.code}): ${result.stderr.slice(0, 300)}`)
    }
    return result.stdout
  }

  // Retry 1x em erro de parse/schema, anexando o erro como feedback.
  private async generateWithRetry(basePrompt: string): Promise<DossierExtractionPayload> {
    const stdout = await this.generate(basePrompt)
    try {
      return parseAndValidate(stdout)
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      const retryPrompt = `${basePrompt}\n\n## Correção\nSua resposta anterior foi rejeitada: ${msg}. Responda novamente APENAS com o bloco JSON válido do schema, sem texto fora do JSON.`
      return parseAndValidate(await this.generate(retryPrompt))
    }
  }
}
