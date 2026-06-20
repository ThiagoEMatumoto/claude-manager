/**
 * Smoke REAL do caminho claude -p da extração de reunião.
 *
 * Usa o runClaude REAL + o prompt REAL + o grounding REAL, mas injeta um store
 * fake em memória (evita a ABI nativa do better-sqlite3 sob tsx). Prova que o
 * `claude -p` text-mode extrai action items ancorados no transcript.
 *
 * Rodar: npx tsx e2e/scenarios/extract-smoke.ts
 */
import { extractMeeting, type ExtractDeps } from '../../electron/main/services/meeting-extraction'
import type {
  AddExtractionInput,
} from '../../electron/main/services/meeting-store'
import type {
  Meeting,
  MeetingExtraction,
  MeetingSegment,
  UpdateMeetingInput,
} from '../../shared/types/ipc'

// As 8 frases do fake_sidecar.py (transcript de exemplo).
const LINES: Array<[string, string]> = [
  ['SPEAKER_00', 'Bom dia pessoal, vamos começar a reunião de planejamento.'],
  ['SPEAKER_01', 'Perfeito. Acho que o primeiro ponto é revisar o roadmap do trimestre.'],
  ['SPEAKER_00', 'Concordo. O João ficou de mandar os números de conversão até sexta.'],
  ['SPEAKER_01', 'Sim, já tenho o draft. Falta só validar com o time de dados.'],
  ['SPEAKER_00', 'Ótimo. E sobre a integração com o Calendar, como está?'],
  ['SPEAKER_02', 'Está quase pronta, devo abrir a PR ainda hoje.'],
  ['SPEAKER_00', 'Show. Então fechamos os action items e seguimos.'],
  ['SPEAKER_01', 'Combinado, obrigado pessoal.'],
]

const SEGMENTS: MeetingSegment[] = LINES.map(([speaker, text], idx) => ({
  id: `seg-${idx}`,
  meetingId: 'smoke',
  idx,
  startMs: idx * 2500,
  endMs: idx * 2500 + 2500,
  speakerLabel: speaker,
  text,
  wordsJson: null,
  avgLogprob: null,
  noSpeechProb: null,
  isPartial: false,
}))

const MEETING: Meeting = {
  id: 'smoke',
  title: 'Planejamento (smoke)',
  startedAt: 0,
  endedAt: null,
  source: null,
  audioPath: null,
  durationMs: null,
  lang: 'pt',
  sttModel: null,
  diarModel: null,
  extractor: null,
  status: 'ready',
  rawNotes: 'revisar roadmap do trimestre; cobrar números do João',
  augmentedNotes: null,
  summary: null,
  createdAt: 0,
  updatedAt: 0,
}

const captured: MeetingExtraction[] = []

const store: ExtractDeps['store'] = {
  get: (): Meeting => MEETING,
  listSegments: (): MeetingSegment[] => SEGMENTS,
  update: (input: UpdateMeetingInput): Meeting => ({ ...MEETING, ...input }) as Meeting,
  addExtraction: (input: AddExtractionInput): MeetingExtraction => {
    const ex: MeetingExtraction = {
      id: `ex-${captured.length}`,
      meetingId: 'smoke',
      type: input.type,
      text: input.text,
      assignee: input.assignee ?? null,
      dueHint: input.dueHint ?? null,
      quote: input.quote ?? null,
      quoteSegmentId: null,
      startMs: input.startMs ?? null,
      endMs: input.endMs ?? null,
      speakerLabel: input.speakerLabel ?? null,
      confidence: input.confidence ?? null,
      grounded: input.grounded ?? false,
      materializedTaskId: null,
      createdAt: Date.now(),
    }
    captured.push(ex)
    return ex
  },
}

async function main() {
  console.log('→ chamando claude -p REAL (pode levar alguns segundos)…\n')
  const result = await extractMeeting('smoke', { store })

  console.log('=== SUMMARY ===')
  console.log(result.summary ?? '(vazio)')
  console.log('\n=== AUGMENTED NOTES ===')
  console.log(result.augmentedNotes ?? '(vazio)')
  console.log('\n=== ITEMS ===')
  for (const ex of result.extractions) {
    console.log(`[${ex.type}] grounded=${ex.grounded ? 1 : 0} :: ${ex.text}`)
    console.log(`   quote: "${ex.quote}"`)
    console.log(`   assignee=${ex.assignee ?? '-'} due=${ex.dueHint ?? '-'} speaker=${ex.speakerLabel ?? '-'}`)
  }
  const grounded = result.extractions.filter((e) => e.grounded).length
  console.log(`\n=== GROUNDING: ${grounded}/${result.extractions.length} grounded ===`)
}

main().catch((err) => {
  console.error('SMOKE FALHOU:', err instanceof Error ? err.message : err)
  process.exit(1)
})
