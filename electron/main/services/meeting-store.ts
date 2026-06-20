import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  CreateMeetingInput,
  ExtractionKind,
  Meeting,
  MeetingExtraction,
  MeetingListFilter,
  MeetingSegment,
  MeetingSpeaker,
  MeetingStatus,
  UpdateMeetingInput,
} from '../../../shared/types/ipc'

// Store de Reuniões (Meeting Intelligence). Mesmo padrão de task-store:
// SQLite-only, search em memória. As tabelas filhas (speakers/segments/
// extractions) saem em cascata no delete da reunião (foreign_keys = ON em db.ts).

// ---- rows <-> entidades ----

interface MeetingRow {
  id: string
  title: string
  started_at: number | null
  ended_at: number | null
  source: string | null
  audio_path: string | null
  duration_ms: number | null
  lang: string
  stt_model: string | null
  diar_model: string | null
  extractor: string | null
  status: string
  raw_notes: string | null
  augmented_notes: string | null
  summary: string | null
  created_at: number
  updated_at: number
}

interface SpeakerRow {
  meeting_id: string
  label: string
  display_name: string | null
  is_local_user: number
}

interface SegmentRow {
  id: string
  meeting_id: string
  idx: number
  start_ms: number | null
  end_ms: number | null
  speaker_label: string | null
  text: string
  words_json: string | null
  avg_logprob: number | null
  no_speech_prob: number | null
  is_partial: number
}

interface ExtractionRow {
  id: string
  meeting_id: string
  type: string
  text: string
  assignee: string | null
  due_hint: string | null
  quote: string | null
  quote_segment_id: string | null
  start_ms: number | null
  end_ms: number | null
  speaker_label: string | null
  confidence: number | null
  grounded: number
  materialized_task_id: string | null
  created_at: number
}

function rowToMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
    audioPath: row.audio_path,
    durationMs: row.duration_ms,
    lang: row.lang,
    sttModel: row.stt_model,
    diarModel: row.diar_model,
    extractor: row.extractor,
    status: row.status as MeetingStatus,
    rawNotes: row.raw_notes,
    augmentedNotes: row.augmented_notes,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToSegment(row: SegmentRow): MeetingSegment {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    idx: row.idx,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    text: row.text,
    wordsJson: row.words_json,
    avgLogprob: row.avg_logprob,
    noSpeechProb: row.no_speech_prob,
    isPartial: row.is_partial === 1,
  }
}

function rowToExtraction(row: ExtractionRow): MeetingExtraction {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    type: row.type as ExtractionKind,
    text: row.text,
    assignee: row.assignee,
    dueHint: row.due_hint,
    quote: row.quote,
    quoteSegmentId: row.quote_segment_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    confidence: row.confidence,
    grounded: row.grounded === 1,
    materializedTaskId: row.materialized_task_id,
    createdAt: row.created_at,
  }
}

function loadMeeting(id: string): Meeting | null {
  const row = getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
    | MeetingRow
    | undefined
  return row ? rowToMeeting(row) : null
}

// ---- API pública ----

export function list(filter?: MeetingListFilter): Meeting[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []
  if (filter?.status) {
    where.push('status = ?')
    params.push(filter.status)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM meetings ${clause} ORDER BY created_at DESC`)
    .all(...params) as MeetingRow[]

  let meetings = rows.map(rowToMeeting)
  if (filter?.search?.trim()) {
    const q = filter.search.trim().toLowerCase()
    meetings = meetings.filter(
      (m) => m.title.toLowerCase().includes(q) || (m.rawNotes ?? '').toLowerCase().includes(q),
    )
  }
  return meetings
}

export function get(id: string): Meeting | null {
  return loadMeeting(id)
}

function meetingToRowParams(meeting: Meeting): Record<string, unknown> {
  return {
    id: meeting.id,
    title: meeting.title,
    started_at: meeting.startedAt,
    ended_at: meeting.endedAt,
    source: meeting.source,
    audio_path: meeting.audioPath,
    duration_ms: meeting.durationMs,
    lang: meeting.lang,
    stt_model: meeting.sttModel,
    diar_model: meeting.diarModel,
    extractor: meeting.extractor,
    status: meeting.status,
    raw_notes: meeting.rawNotes,
    augmented_notes: meeting.augmentedNotes,
    summary: meeting.summary,
    created_at: meeting.createdAt,
    updated_at: meeting.updatedAt,
  }
}

export function create(input: CreateMeetingInput): Meeting {
  const now = Date.now()
  const status = input.status ?? 'recording'
  const meeting: Meeting = {
    id: randomUUID(),
    title: input.title.trim(),
    startedAt: status === 'recording' ? now : null,
    endedAt: null,
    source: input.source ?? null,
    audioPath: null,
    durationMs: null,
    lang: input.lang ?? 'pt',
    sttModel: null,
    diarModel: null,
    extractor: null,
    status,
    rawNotes: input.rawNotes ?? null,
    augmentedNotes: null,
    summary: null,
    createdAt: now,
    updatedAt: now,
  }
  getDb()
    .prepare(
      `INSERT INTO meetings
         (id, title, started_at, ended_at, source, audio_path, duration_ms, lang,
          stt_model, diar_model, extractor, status, raw_notes, augmented_notes,
          summary, created_at, updated_at)
       VALUES (@id, @title, @started_at, @ended_at, @source, @audio_path, @duration_ms, @lang,
               @stt_model, @diar_model, @extractor, @status, @raw_notes, @augmented_notes,
               @summary, @created_at, @updated_at)`,
    )
    .run(meetingToRowParams(meeting))
  return meeting
}

// undefined = mantém o valor atual; null explícito limpa o campo.
function keep<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next
}

export function update(input: UpdateMeetingInput): Meeting {
  const current = loadMeeting(input.id)
  if (!current) throw new Error(`meeting not found: ${input.id}`)

  const now = Date.now()
  const status = input.status ?? current.status
  // ended_at fica coerente com o status terminal: entrar em ready/extracted/
  // failed carimba o fim (se vazio); status de gravação ainda em curso não.
  const isTerminal = status === 'ready' || status === 'extracted' || status === 'failed'
  const endedAt = keep(input.endedAt, isTerminal ? (current.endedAt ?? now) : current.endedAt)

  const next: Meeting = {
    ...current,
    title: input.title?.trim() || current.title,
    startedAt: keep(input.startedAt, current.startedAt),
    endedAt,
    source: keep(input.source, current.source),
    audioPath: keep(input.audioPath, current.audioPath),
    durationMs: keep(input.durationMs, current.durationMs),
    lang: input.lang ?? current.lang,
    sttModel: keep(input.sttModel, current.sttModel),
    diarModel: keep(input.diarModel, current.diarModel),
    extractor: keep(input.extractor, current.extractor),
    status,
    rawNotes: keep(input.rawNotes, current.rawNotes),
    augmentedNotes: keep(input.augmentedNotes, current.augmentedNotes),
    summary: keep(input.summary, current.summary),
    updatedAt: now,
  }

  getDb()
    .prepare(
      `UPDATE meetings SET
         title = @title, started_at = @started_at, ended_at = @ended_at, source = @source,
         audio_path = @audio_path, duration_ms = @duration_ms, lang = @lang,
         stt_model = @stt_model, diar_model = @diar_model, extractor = @extractor,
         status = @status, raw_notes = @raw_notes, augmented_notes = @augmented_notes,
         summary = @summary, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(meetingToRowParams(next))
  return next
}

export function remove(id: string): void {
  // speakers/segments/extractions saem junto via ON DELETE CASCADE.
  getDb().prepare('DELETE FROM meetings WHERE id = ?').run(id)
}

// ---- segmentos ----

export interface AppendSegmentInput {
  meetingId: string
  startMs?: number | null
  endMs?: number | null
  speakerLabel?: string | null
  text: string
  wordsJson?: string | null
  avgLogprob?: number | null
  noSpeechProb?: number | null
  isPartial?: boolean
}

function nextSegmentIdx(meetingId: string): number {
  const row = getDb()
    .prepare('SELECT MAX(idx) AS max FROM meeting_segments WHERE meeting_id = ?')
    .get(meetingId) as { max: number | null }
  return (row.max ?? -1) + 1
}

export function appendSegment(input: AppendSegmentInput): MeetingSegment {
  const segment: MeetingSegment = {
    id: randomUUID(),
    meetingId: input.meetingId,
    idx: nextSegmentIdx(input.meetingId),
    startMs: input.startMs ?? null,
    endMs: input.endMs ?? null,
    speakerLabel: input.speakerLabel ?? null,
    text: input.text,
    wordsJson: input.wordsJson ?? null,
    avgLogprob: input.avgLogprob ?? null,
    noSpeechProb: input.noSpeechProb ?? null,
    isPartial: input.isPartial ?? false,
  }
  getDb()
    .prepare(
      `INSERT INTO meeting_segments
         (id, meeting_id, idx, start_ms, end_ms, speaker_label, text, words_json,
          avg_logprob, no_speech_prob, is_partial)
       VALUES (@id, @meeting_id, @idx, @start_ms, @end_ms, @speaker_label, @text, @words_json,
               @avg_logprob, @no_speech_prob, @is_partial)`,
    )
    .run({
      id: segment.id,
      meeting_id: segment.meetingId,
      idx: segment.idx,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker_label: segment.speakerLabel,
      text: segment.text,
      words_json: segment.wordsJson,
      avg_logprob: segment.avgLogprob,
      no_speech_prob: segment.noSpeechProb,
      is_partial: segment.isPartial ? 1 : 0,
    })
  return segment
}

export function listSegments(meetingId: string): MeetingSegment[] {
  const rows = getDb()
    .prepare('SELECT * FROM meeting_segments WHERE meeting_id = ? ORDER BY idx ASC')
    .all(meetingId) as SegmentRow[]
  return rows.map(rowToSegment)
}

// ---- speakers ----

export function listSpeakers(meetingId: string): MeetingSpeaker[] {
  const rows = getDb()
    .prepare('SELECT * FROM meeting_speakers WHERE meeting_id = ? ORDER BY label ASC')
    .all(meetingId) as SpeakerRow[]
  return rows.map((r) => ({
    meetingId: r.meeting_id,
    label: r.label,
    displayName: r.display_name,
    isLocalUser: r.is_local_user === 1,
  }))
}

// Upsert do nome do speaker (label→pessoa). Cria a linha se o label ainda não
// existe (o sidecar pode não ter pré-registrado os labels).
export function setSpeakerName(
  meetingId: string,
  label: string,
  displayName: string,
): MeetingSpeaker {
  getDb()
    .prepare(
      `INSERT INTO meeting_speakers (meeting_id, label, display_name)
       VALUES (?, ?, ?)
       ON CONFLICT (meeting_id, label) DO UPDATE SET display_name = excluded.display_name`,
    )
    .run(meetingId, label, displayName)
  const row = getDb()
    .prepare('SELECT * FROM meeting_speakers WHERE meeting_id = ? AND label = ?')
    .get(meetingId, label) as SpeakerRow
  return {
    meetingId: row.meeting_id,
    label: row.label,
    displayName: row.display_name,
    isLocalUser: row.is_local_user === 1,
  }
}

// ---- extractions ----

export interface AddExtractionInput {
  meetingId: string
  type: ExtractionKind
  text: string
  assignee?: string | null
  dueHint?: string | null
  quote?: string | null
  quoteSegmentId?: string | null
  startMs?: number | null
  endMs?: number | null
  speakerLabel?: string | null
  confidence?: number | null
  grounded?: boolean
}

export function addExtraction(input: AddExtractionInput): MeetingExtraction {
  const extraction: MeetingExtraction = {
    id: randomUUID(),
    meetingId: input.meetingId,
    type: input.type,
    text: input.text,
    assignee: input.assignee ?? null,
    dueHint: input.dueHint ?? null,
    quote: input.quote ?? null,
    quoteSegmentId: input.quoteSegmentId ?? null,
    startMs: input.startMs ?? null,
    endMs: input.endMs ?? null,
    speakerLabel: input.speakerLabel ?? null,
    confidence: input.confidence ?? null,
    grounded: input.grounded ?? false,
    materializedTaskId: null,
    createdAt: Date.now(),
  }
  getDb()
    .prepare(
      `INSERT INTO meeting_extractions
         (id, meeting_id, type, text, assignee, due_hint, quote, quote_segment_id,
          start_ms, end_ms, speaker_label, confidence, grounded, materialized_task_id, created_at)
       VALUES (@id, @meeting_id, @type, @text, @assignee, @due_hint, @quote, @quote_segment_id,
               @start_ms, @end_ms, @speaker_label, @confidence, @grounded, @materialized_task_id,
               @created_at)`,
    )
    .run({
      id: extraction.id,
      meeting_id: extraction.meetingId,
      type: extraction.type,
      text: extraction.text,
      assignee: extraction.assignee,
      due_hint: extraction.dueHint,
      quote: extraction.quote,
      quote_segment_id: extraction.quoteSegmentId,
      start_ms: extraction.startMs,
      end_ms: extraction.endMs,
      speaker_label: extraction.speakerLabel,
      confidence: extraction.confidence,
      grounded: extraction.grounded ? 1 : 0,
      materialized_task_id: extraction.materializedTaskId,
      created_at: extraction.createdAt,
    })
  return extraction
}

export function listExtractions(meetingId: string): MeetingExtraction[] {
  const rows = getDb()
    .prepare('SELECT * FROM meeting_extractions WHERE meeting_id = ? ORDER BY created_at ASC')
    .all(meetingId) as ExtractionRow[]
  return rows.map(rowToExtraction)
}

// Idempotência da materialização: grava o task_id gerado pra que re-aprovar a
// mesma extração não crie uma segunda task.
export function markExtractionMaterialized(
  extractionId: string,
  taskId: string,
): MeetingExtraction | null {
  getDb()
    .prepare('UPDATE meeting_extractions SET materialized_task_id = ? WHERE id = ?')
    .run(taskId, extractionId)
  const row = getDb()
    .prepare('SELECT * FROM meeting_extractions WHERE id = ?')
    .get(extractionId) as ExtractionRow | undefined
  return row ? rowToExtraction(row) : null
}
