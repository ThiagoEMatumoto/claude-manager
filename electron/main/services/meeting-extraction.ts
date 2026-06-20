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

// Coração da Meeting Intelligence: transcript + notas → claude -p → notas
// aumentadas + itens (action items/decisões/feedbacks) com quote literal, cada
// item validado por grounding (a quote tem que casar com o transcript real).
// Só o caminho `claude -p` text-mode (provado em feature-memory.ts); o fallback
// Ollama é OUTRA fatia.

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
  return segments.some((seg) => normalizeForMatch(seg.text).includes(q))
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
}

export interface ExtractDeps {
  runClaude: (args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>
  store: ExtractStore
  objectives?: PromptLinkable[]
  features?: PromptLinkable[]
}

function toPromptSegments(segments: MeetingSegment[]): PromptSegment[] {
  return segments.map((s) => ({
    speakerLabel: s.speakerLabel,
    startMs: s.startMs,
    text: s.text,
  }))
}

async function runOnce(
  deps: Pick<ExtractDeps, 'runClaude'>,
  prompt: string,
): Promise<{ result: RunResult; payload?: ExtractionPayload; parseError?: string }> {
  const result = await deps.runClaude(['-p', prompt, '--output-format', 'text'], {
    timeoutMs: EXTRACTION_TIMEOUT_MS,
  })
  if (result.code !== 0) return { result }
  try {
    return { result, payload: parseAndValidate(result.stdout) }
  } catch (err) {
    return { result, parseError: err instanceof Error ? err.message : String(err) }
  }
}

// `store` é obrigatório e SEMPRE injetado pelo caller (produção injeta o real;
// testes/smoke injetam um stub). `runClaude` é opcional (default real).
export interface ExtractOptions {
  store: ExtractStore
  runClaude?: ExtractDeps['runClaude']
  objectives?: PromptLinkable[]
  features?: PromptLinkable[]
}

// Extrai uma reunião e persiste o resultado. Retry 1x em erro de parse/schema
// (re-chama anexando a mensagem de erro). Erro do runClaude (claude ausente/
// falha) sobe claro — sem inventar resultado (fallback Ollama é outra fatia).
export async function extractMeeting(
  meetingId: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const deps: ExtractDeps = {
    runClaude: options.runClaude ?? runClaude,
    store: options.store,
    objectives: options.objectives,
    features: options.features,
  }
  const store = deps.store

  const meeting = store.get(meetingId)
  if (!meeting) throw new Error(`reunião não encontrada: ${meetingId}`)

  const segments = store.listSegments(meetingId)
  if (segments.length === 0) {
    throw new Error('a reunião não tem transcript — nada para extrair')
  }

  const basePrompt = composeExtractionPrompt({
    rawNotes: meeting.rawNotes,
    segments: toPromptSegments(segments),
    objectives: deps.objectives,
    features: deps.features,
  })

  let attempt = await runOnce(deps, basePrompt)
  if (attempt.result.code !== 0) {
    throw new Error(
      `claude -p falhou (exit ${attempt.result.code}): ${attempt.result.stderr.slice(0, 300)}`,
    )
  }

  // Retry 1x só pra erro de parse/schema, anexando o erro como feedback.
  if (!attempt.payload && attempt.parseError) {
    const retryPrompt = `${basePrompt}\n\n## Correção\nSua resposta anterior foi rejeitada: ${attempt.parseError}. Responda novamente APENAS com o bloco JSON válido do schema, sem texto fora do JSON.`
    attempt = await runOnce(deps, retryPrompt)
    if (attempt.result.code !== 0) {
      throw new Error(
        `claude -p falhou no retry (exit ${attempt.result.code}): ${attempt.result.stderr.slice(0, 300)}`,
      )
    }
  }

  if (!attempt.payload) {
    throw new Error(`não foi possível parsear a extração: ${attempt.parseError ?? 'desconhecido'}`)
  }

  const payload = attempt.payload
  const summary = payload.summary?.trim() || null
  const augmentedNotes = payload.augmented_notes?.trim() || null

  store.update({
    id: meetingId,
    summary,
    augmentedNotes,
    extractor: 'claude -p',
    status: 'extracted',
  })

  const extractions: MeetingExtraction[] = []
  for (const item of payload.items) {
    const grounded = isGrounded(item.quote, segments)
    const extraction = store.addExtraction({
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
    })
    extractions.push(extraction)
  }

  return { summary, augmentedNotes, extractions }
}
