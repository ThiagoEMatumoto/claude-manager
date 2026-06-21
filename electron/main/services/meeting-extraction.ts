import * as z from 'zod/v4'
import type {
  ExtractionKind,
  Meeting,
  MeetingExtraction,
  MeetingSegment,
  UpdateMeetingInput,
} from '../../../shared/types/ipc'
import { runClaude, type RunResult } from './claude-cli'
import type { AddExtractionInput } from './meeting-store'
import {
  composeExtractionPrompt,
  type PromptLinkable,
  type PromptSegment,
} from './meeting/compose-extraction-prompt'
import { chunkSegments } from './meeting/chunk-segments'
import {
  isOllamaAvailable,
  ollamaGenerate,
  type OllamaOptions,
} from './meeting/ollama-client'

// Coração da Meeting Intelligence: transcript + notas → modelo → notas
// aumentadas + itens (action items/decisões/feedbacks) com quote literal, cada
// item validado por grounding (a quote tem que casar com o transcript real).
//
// Dois provedores compartilham o MESMO prompt, schema zod, parse e grounding:
//   - claude -p (text-mode) — caminho online padrão;
//   - Ollama (localhost) — offline/privado, com JSON Schema enforçado.
// A seleção (auto/claude/ollama + modo privado) e o chunking/map-reduce para
// transcripts longos vivem aqui.

const EXTRACTION_TIMEOUT_MS = 120_000

// ---- schema (zod) do JSON que o modelo deve emitir ----

const extractionKind = z.enum(['action_item', 'decision', 'feedback', 'risk', 'question'])

const suggestedLink = z
  .object({
    type: z.enum(['objective', 'feature']),
    id: z.string().min(1),
  })
  .nullish()

const itemSchema = z.object({
  type: extractionKind,
  text: z.string().min(1),
  assignee: z.string().nullish(),
  due_hint: z.string().nullish(),
  quote: z.string().min(1),
  start_ms: z.number().nullish(),
  end_ms: z.number().nullish(),
  speaker_label: z.string().nullish(),
  confidence: z.number().nullish(),
  suggested_link: suggestedLink,
})

const resultSchema = z.object({
  summary: z.string().nullish(),
  augmented_notes: z.string().nullish(),
  items: z.array(itemSchema),
})

export type ExtractionItem = z.infer<typeof itemSchema>
export type ExtractionPayload = z.infer<typeof resultSchema>

// JSON Schema (draft 2020-12) derivado do MESMO zod, para o `format` do Ollama
// (structured outputs). Reusa a fonte de verdade do parse — sem schema paralelo.
export const ollamaResultJsonSchema = z.toJSONSchema(resultSchema)

// ---- grounding ----

// Normaliza para o match de substring: lowercase, sem acento, espaços
// colapsados, trim. A quote casa quando o texto normalizado de algum segmento
// contém a quote normalizada.
// eslint-disable-next-line no-misleading-character-class -- combining marks (NFD)
const COMBINING_MARKS = /[̀-ͯ]/g

export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function isGrounded(quote: string, segments: { text: string }[]): boolean {
  const q = normalizeForMatch(quote)
  if (!q) return false
  if (segments.some((seg) => normalizeForMatch(seg.text).includes(q))) return true
  // Fallback p/ quotes que CRUZAM 2+ segments (o modelo cita uma frase contínua
  // que a diarização quebrou em linhas): compara contra a concatenação normalizada
  // de todos os segments (com espaço entre eles).
  const joined = normalizeForMatch(segments.map((seg) => seg.text).join(' '))
  return joined.includes(q)
}

// ---- parse tolerante a banner/code fence ----

// Extrai o primeiro objeto JSON de topo do stdout (igual runClaudeJson, mas
// recortando do `{` até o `}` casado, pra tolerar lixo depois do JSON também).
export function extractJsonBlock(stdout: string): string | null {
  const start = stdout.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return stdout.slice(start, i + 1)
    }
  }
  return null
}

function parseAndValidate(stdout: string): ExtractionPayload {
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

// ---- serviço ----

export interface ExtractResult {
  summary: string | null
  augmentedNotes: string | null
  extractions: MeetingExtraction[]
}

// Só o subconjunto do meeting-store que a extração realmente usa. Definido
// estruturalmente (não `typeof meetingStore`) para que ESTE módulo NÃO importe
// meeting-store — assim nada puxa db→electron no bundle e o módulo é importável
// sob tsx. O store SEMPRE chega por injeção (produção injeta o real; testes/
// smoke injetam um stub em memória).
export interface ExtractStore {
  get: (id: string) => Meeting | null
  listSegments: (meetingId: string) => MeetingSegment[]
  update: (input: UpdateMeetingInput) => Meeting
  addExtraction: (input: AddExtractionInput) => MeetingExtraction
  // Limpa extrações não-materializadas antes do re-insert (evita duplicar na
  // re-extração e orfanar materialized_task_id).
  deleteExtractions: (meetingId: string) => void
  // Atomicidade do delete + re-inserts. Opcional: sem ela rodamos sem transação
  // (stubs de teste podem omitir).
  runInTransaction?: <T>(fn: () => T) => T
}

// Como o transcript vira itens. Injetável (default real) e mockável nos testes
// sem rede nem `claude`.
export type ExtractProvider = 'claude' | 'ollama'

// Preferência efetiva resolvida pela camada IPC: 'auto' decide aqui (claude com
// fallback Ollama); 'claude'/'ollama' forçam um provedor; modo privado equivale
// a 'ollama' sem nenhuma chamada ao processo `claude`.
export type ProviderPref = 'claude' | 'ollama' | 'auto'

export interface ExtractDeps {
  runClaude: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>
  // I/O do Ollama injetável (default real). Os testes passam um fetch mockado via
  // ollama.fetchImpl.
  ollama?: OllamaOptions
  // Override total da geração (usado por testes p/ não tocar claude nem ollama).
  generate?: (prompt: string, provider: ExtractProvider) => Promise<RawGeneration>
  isOllamaAvailable?: (opts?: OllamaOptions) => Promise<boolean>
  store: ExtractStore
  objectives?: PromptLinkable[]
  features?: PromptLinkable[]
  providerPref?: ProviderPref
}

function toPromptSegments(segments: MeetingSegment[]): PromptSegment[] {
  return segments.map((s) => ({
    speakerLabel: s.speakerLabel,
    startMs: s.startMs,
    text: s.text,
  }))
}

// Resultado cru de um provedor: o texto bruto a ser parseado + o rótulo do
// extractor pra carimbar a reunião.
export interface RawGeneration {
  stdout: string
  extractorLabel: string
}

// ---- geração por provedor (claude -p / ollama) ----

async function generateClaude(
  deps: Pick<ExtractDeps, 'runClaude'>,
  prompt: string,
): Promise<RawGeneration> {
  const result = await deps.runClaude(['-p', prompt, '--output-format', 'text'], {
    timeoutMs: EXTRACTION_TIMEOUT_MS,
  })
  if (result.code !== 0) {
    throw new Error(
      `claude -p falhou (exit ${result.code}): ${result.stderr.slice(0, 300)}`,
    )
  }
  return { stdout: result.stdout, extractorLabel: 'claude -p' }
}

async function generateOllama(
  deps: Pick<ExtractDeps, 'ollama'>,
  prompt: string,
): Promise<RawGeneration> {
  const res = await ollamaGenerate(prompt, ollamaResultJsonSchema, {
    ...deps.ollama,
    timeoutMs: deps.ollama?.timeoutMs ?? EXTRACTION_TIMEOUT_MS,
  })
  return { stdout: res.response, extractorLabel: `ollama:${res.model}` }
}

// Resolve o provedor efetivo dado a pref e a disponibilidade do Ollama.
// - 'ollama' / modo privado → ollama (sem tocar claude);
// - 'claude' → claude (sem fallback automático aqui; erro do claude sobe);
// - 'auto'  → claude, com fallback ollama quando o claude falha E o ollama está
//   disponível.
// Retorna a função de geração + se deve tentar fallback ollama em erro.
interface ProviderPlan {
  primary: ExtractProvider
  fallbackToOllama: boolean
}

async function resolveProviderPlan(deps: ExtractDeps): Promise<ProviderPlan> {
  const pref = deps.providerPref ?? 'auto'
  if (pref === 'ollama') return { primary: 'ollama', fallbackToOllama: false }
  if (pref === 'claude') return { primary: 'claude', fallbackToOllama: false }
  // auto: claude primeiro; fallback ollama só se ele estiver no ar.
  const check = deps.isOllamaAvailable ?? isOllamaAvailable
  const ollamaUp = await check(deps.ollama)
  return { primary: 'claude', fallbackToOllama: ollamaUp }
}

async function generateWith(deps: ExtractDeps, prompt: string, provider: ExtractProvider): Promise<RawGeneration> {
  if (deps.generate) return deps.generate(prompt, provider)
  return provider === 'ollama' ? generateOllama(deps, prompt) : generateClaude(deps, prompt)
}

// Gera + parseia 1 bloco, com retry 1x em erro de parse/schema (anexa o erro
// como feedback). Aplica o plano de provedor: se o primário falha (na geração) e
// há fallback ollama, tenta o ollama.
async function extractBlock(
  deps: ExtractDeps,
  basePrompt: string,
  plan: ProviderPlan,
): Promise<{ payload: ExtractionPayload; extractorLabel: string }> {
  const tryProvider = async (provider: ExtractProvider): Promise<{ payload: ExtractionPayload; extractorLabel: string }> => {
    const gen = await generateWith(deps, basePrompt, provider)
    try {
      return { payload: parseAndValidate(gen.stdout), extractorLabel: gen.extractorLabel }
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      const retryPrompt = `${basePrompt}\n\n## Correção\nSua resposta anterior foi rejeitada: ${msg}. Responda novamente APENAS com o bloco JSON válido do schema, sem texto fora do JSON.`
      const retry = await generateWith(deps, retryPrompt, provider)
      return { payload: parseAndValidate(retry.stdout), extractorLabel: retry.extractorLabel }
    }
  }

  try {
    return await tryProvider(plan.primary)
  } catch (primaryErr) {
    if (plan.fallbackToOllama && plan.primary !== 'ollama') {
      return tryProvider('ollama')
    }
    throw primaryErr
  }
}

// ---- map-reduce de chunks ----

// Consolida itens de vários chunks: dedupe por (type, quote normalizada). O
// overlap entre chunks naturalmente gera duplicatas — colapsamos mantendo a 1ª.
function dedupeItems(items: ExtractionItem[]): ExtractionItem[] {
  const seen = new Set<string>()
  const out: ExtractionItem[] = []
  for (const item of items) {
    const key = `${item.type}::${normalizeForMatch(item.quote)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

// `store` é obrigatório e SEMPRE injetado pelo caller (produção injeta o real;
// testes/smoke injetam um stub). Todos os outros campos têm default real.
export interface ExtractOptions {
  store: ExtractStore
  runClaude?: ExtractDeps['runClaude']
  ollama?: OllamaOptions
  generate?: ExtractDeps['generate']
  isOllamaAvailable?: ExtractDeps['isOllamaAvailable']
  objectives?: PromptLinkable[]
  features?: PromptLinkable[]
  providerPref?: ProviderPref
}

// Extrai uma reunião e persiste o resultado.
// - Seleção de provedor: auto (claude→fallback ollama) | claude | ollama.
// - Chunking/map-reduce: transcripts longos são fatiados (com overlap), extraídos
//   por bloco e consolidados (dedupe por type+quote). O summary/augmented_notes
//   vem do 1º chunk (o que tem as notas do usuário e o início da reunião).
// - Grounding: cada quote é validada contra o transcript COMPLETO (não só o chunk).
export async function extractMeeting(
  meetingId: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const deps: ExtractDeps = {
    runClaude: options.runClaude ?? runClaude,
    ollama: options.ollama,
    generate: options.generate,
    isOllamaAvailable: options.isOllamaAvailable,
    store: options.store,
    objectives: options.objectives,
    features: options.features,
    providerPref: options.providerPref,
  }
  const store = deps.store

  const meeting = store.get(meetingId)
  if (!meeting) throw new Error(`reunião não encontrada: ${meetingId}`)

  const segments = store.listSegments(meetingId)
  if (segments.length === 0) {
    throw new Error('a reunião não tem transcript — nada para extrair')
  }

  const promptSegments = toPromptSegments(segments)
  const chunks = chunkSegments(promptSegments)
  const plan = await resolveProviderPlan(deps)

  let summary: string | null = null
  let augmentedNotes: string | null = null
  let extractorLabel: string = plan.primary
  const allItems: ExtractionItem[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const prompt = composeExtractionPrompt({
      // As notas do usuário entram só no 1º chunk (evita repeti-las/duplicar
      // augmented_notes em cada bloco).
      rawNotes: i === 0 ? meeting.rawNotes : null,
      segments: chunk,
      objectives: deps.objectives,
      features: deps.features,
    })
    const { payload, extractorLabel: label } = await extractBlock(deps, prompt, plan)
    extractorLabel = label
    if (i === 0) {
      summary = payload.summary?.trim() || null
      augmentedNotes = payload.augmented_notes?.trim() || null
    }
    allItems.push(...payload.items)
  }

  const items = dedupeItems(allItems)

  // Persist atômico: status + limpeza das extrações antigas (não-materializadas) +
  // re-inserts numa única transação. Re-enriquecer não duplica itens nem orfana os
  // já materializados.
  const persist = (): MeetingExtraction[] => {
    store.update({
      id: meetingId,
      summary,
      augmentedNotes,
      extractor: extractorLabel,
      status: 'extracted',
    })
    store.deleteExtractions(meetingId)

    const out: MeetingExtraction[] = []
    for (const item of items) {
      // Grounding contra o transcript COMPLETO (não só o chunk de origem).
      const grounded = isGrounded(item.quote, segments)
      out.push(
        store.addExtraction({
          meetingId,
          type: item.type as ExtractionKind,
          text: item.text,
          assignee: item.assignee ?? null,
          dueHint: item.due_hint ?? null,
          quote: item.quote,
          startMs: item.start_ms ?? null,
          endMs: item.end_ms ?? null,
          speakerLabel: item.speaker_label ?? null,
          confidence: item.confidence ?? null,
          grounded,
        }),
      )
    }
    return out
  }

  const extractions = store.runInTransaction ? store.runInTransaction(persist) : persist()

  return { summary, augmentedNotes, extractions }
}
