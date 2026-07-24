import type { ExtractionKind, MeetingStatus } from '../../../shared/types/ipc'

// Cor (var CSS) + label pt-BR por status de reunião. Mesmo padrão de
// tasks/status.ts: reaproveita o design system.
export const MEETING_STATUS_META: Record<MeetingStatus, { label: string; color: string }> = {
  idle: { label: 'rascunho', color: 'var(--color-text-dim)' },
  capturing: { label: 'capturando', color: 'var(--color-danger)' },
  recording: { label: 'gravando', color: 'var(--color-danger)' },
  transcribing: { label: 'transcrevendo', color: 'var(--color-warning)' },
  diarizing: { label: 'identificando vozes', color: 'var(--color-warning)' },
  ready: { label: 'pronta', color: 'var(--color-info)' },
  extracted: { label: 'extraída', color: 'var(--color-success)' },
  failed: { label: 'falhou', color: 'var(--color-danger)' },
}

// Label + cor por tipo de item extraído (action item/decisão/feedback…).
export const EXTRACTION_KIND_META: Record<ExtractionKind, { label: string; color: string }> = {
  action_item: { label: 'Ação', color: 'var(--color-accent)' },
  decision: { label: 'Decisão', color: 'var(--color-success)' },
  feedback: { label: 'Feedback', color: 'var(--color-info)' },
  risk: { label: 'Risco', color: 'var(--color-danger)' },
  question: { label: 'Pergunta', color: 'var(--color-warning)' },
}

export const EXTRACTION_KIND_ORDER: ExtractionKind[] = [
  'action_item',
  'decision',
  'feedback',
  'risk',
  'question',
]
