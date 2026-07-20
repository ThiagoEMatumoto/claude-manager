import * as z from 'zod/v4'
import { runClaude, type RunResult } from '../claude-cli'
import { extractJsonBlock } from '../meeting-extraction'
import type { SynthRecord, Synthesizer } from '../dossier-pipeline-types'
import {
  composeDossierSynthesisPrompt,
  identifyRecords,
  SECTION_ORDER,
  SECTION_TITLES,
  type SynthSection,
} from './compose-synthesis-prompt'

// Synthesizer real: evidências verificadas → síntese graduada em markdown, via
// `claude -p` (text-mode). O agrupamento nas 5 seções continua sendo regra de
// produto (determinística); o modelo escreve a prosa.
//
// Validação pós-parse: toda afirmação precisa citar `evidence_id` existente no
// conjunto verificado. Id inexistente é removido da citação; afirmação que fica
// sem nenhuma citação válida é descartada (exceto em "Lacunas", onde a ausência
// de evidência é o conteúdo).

const SYNTHESIS_TIMEOUT_MS = 180_000

const claimLineSchema = z.object({
  text: z.string().min(1),
  evidence_ids: z.array(z.string()).nullish(),
})

const resultSchema = z.object({
  sections: z.object({
    confirmed: z.array(claimLineSchema).nullish(),
    contested: z.array(claimLineSchema).nullish(),
    singleSource: z.array(claimLineSchema).nullish(),
    marketSignal: z.array(claimLineSchema).nullish(),
    gaps: z.array(claimLineSchema).nullish(),
  }),
})

export type DossierSynthesisPayload = z.infer<typeof resultSchema>

function parseAndValidate(stdout: string): DossierSynthesisPayload {
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

function renderSection(
  section: SynthSection,
  lines: { text: string; evidence_ids?: string[] | null }[] | null | undefined,
  knownIds: Set<string>,
): string {
  const rendered: string[] = []
  for (const line of lines ?? []) {
    const ids = (line.evidence_ids ?? []).filter((id) => knownIds.has(id))
    if (ids.length === 0 && section !== 'gaps') continue
    const suffix = ids.length > 0 ? ` [${ids.join(', ')}]` : ''
    rendered.push(`- ${line.text.trim()}${suffix}`)
  }
  const body = rendered.length > 0 ? rendered.join('\n') : '_nenhum_'
  return `## ${SECTION_TITLES[section]}\n${body}`
}

export interface ClaudeSynthesizerOptions {
  runClaude?: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>
  // Pergunta do dossiê, quando o caller a conhece — orienta a seção de lacunas.
  question?: string
}

export class ClaudeSynthesizer implements Synthesizer {
  private readonly run: NonNullable<ClaudeSynthesizerOptions['runClaude']>
  private readonly question?: string

  constructor(options: ClaudeSynthesizerOptions = {}) {
    this.run = options.runClaude ?? runClaude
    this.question = options.question
  }

  async synthesize(records: readonly SynthRecord[]): Promise<string> {
    const items = identifyRecords(records)
    const prompt = composeDossierSynthesisPrompt({ question: this.question, items })
    const payload = await this.generateWithRetry(prompt)

    const knownIds = new Set(items.map((it) => it.id))
    return SECTION_ORDER.map((section) =>
      renderSection(section, payload.sections[section], knownIds),
    ).join('\n\n')
  }

  private async generate(prompt: string): Promise<string> {
    const result = await this.run(['-p', prompt, '--output-format', 'text'], {
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
    })
    if (result.code !== 0) {
      throw new Error(`claude -p falhou (exit ${result.code}): ${result.stderr.slice(0, 300)}`)
    }
    return result.stdout
  }

  private async generateWithRetry(basePrompt: string): Promise<DossierSynthesisPayload> {
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
