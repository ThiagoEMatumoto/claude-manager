import * as z from 'zod/v4'
import { runClaude, type RunResult } from '../claude-cli'
import { extractJsonBlock } from '../meeting-extraction'
import {
  routeEvidenceState,
  type VerifyCandidate,
  type Verifier,
  type VerifyVerdict,
} from '../dossier-pipeline-types'
import {
  composeDossierVerificationPrompt,
  labelCandidates,
  type LabeledCandidate,
} from './compose-verification-prompt'

// Verifier real: julgamento semântico cruzado via `claude -p` (text-mode) + o
// roteamento por trust tier, que continua determinístico (routeEvidenceState).
//
// O modelo só diz QUEM corrobora e QUEM contradiz quem. Tudo que ele devolve é
// filtrado: rótulo desconhecido, auto-referência e par da MESMA fonte são
// descartados. As duas relações são simétricas, então normalizamos nos dois
// sentidos (se o modelo só cita um lado, o outro herda).

const VERIFICATION_TIMEOUT_MS = 120_000

const relationSchema = z.object({
  claim_id: z.string().min(1),
  corroborated_by: z.array(z.string()).nullish(),
  contradicted_by: z.array(z.string()).nullish(),
})

const resultSchema = z.object({
  relations: z.array(relationSchema),
})

export type DossierVerificationPayload = z.infer<typeof resultSchema>

function parseAndValidate(stdout: string): DossierVerificationPayload {
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

// Relações aceitas, por rótulo. Simétricas e sem par da mesma fonte.
class RelationSet {
  private readonly links = new Map<string, Set<string>>()

  constructor(private readonly byLabel: Map<string, LabeledCandidate>) {}

  add(fromLabel: string, toLabel: string): void {
    const from = this.byLabel.get(fromLabel)
    const to = this.byLabel.get(toLabel)
    if (!from || !to) return
    if (from.label === to.label) return
    if (from.candidate.sourceId === to.candidate.sourceId) return
    this.link(from.label, to.label)
    this.link(to.label, from.label)
  }

  private link(a: string, b: string): void {
    const set = this.links.get(a) ?? new Set<string>()
    set.add(b)
    this.links.set(a, set)
  }

  idsFor(label: string, byLabel: Map<string, LabeledCandidate>): string[] {
    const labels = this.links.get(label)
    if (!labels) return []
    return [...labels].map((l) => byLabel.get(l)!.candidate.id)
  }
}

export interface ClaudeVerifierOptions {
  runClaude?: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>
}

export class ClaudeVerifier implements Verifier {
  private readonly run: NonNullable<ClaudeVerifierOptions['runClaude']>

  constructor(options: ClaudeVerifierOptions = {}) {
    this.run = options.runClaude ?? runClaude
  }

  async verify(candidates: readonly VerifyCandidate[]): Promise<Map<string, VerifyVerdict>> {
    const out = new Map<string, VerifyVerdict>()
    if (candidates.length === 0) return out

    const items = labelCandidates(candidates)
    const byLabel = new Map(items.map((it) => [it.label, it]))
    const payload = await this.generateWithRetry(composeDossierVerificationPrompt(items))

    const corroboration = new RelationSet(byLabel)
    const contradiction = new RelationSet(byLabel)
    for (const relation of payload.relations) {
      for (const other of relation.corroborated_by ?? []) {
        corroboration.add(relation.claim_id, other)
      }
      for (const other of relation.contradicted_by ?? []) {
        contradiction.add(relation.claim_id, other)
      }
    }

    for (const item of items) {
      const corroboratedBy = corroboration.idsFor(item.label, byLabel)
      const contradictedBy = contradiction.idsFor(item.label, byLabel)
      out.set(item.candidate.id, {
        state: routeEvidenceState(item.candidate.trustTier, corroboratedBy, contradictedBy),
        corroboratedBy,
        contradictedBy,
      })
    }
    return out
  }

  private async generate(prompt: string): Promise<string> {
    const result = await this.run(['-p', prompt, '--output-format', 'text'], {
      timeoutMs: VERIFICATION_TIMEOUT_MS,
    })
    if (result.code !== 0) {
      throw new Error(`claude -p falhou (exit ${result.code}): ${result.stderr.slice(0, 300)}`)
    }
    return result.stdout
  }

  private async generateWithRetry(basePrompt: string): Promise<DossierVerificationPayload> {
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
