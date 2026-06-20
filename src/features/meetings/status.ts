import type { MeetingStatus } from '../../../shared/types/ipc'

// Cor (var CSS) + label pt-BR por status de reunião. Mesmo padrão de
// tasks/status.ts: reaproveita o design system.
export const MEETING_STATUS_META: Record<MeetingStatus, { label: string; color: string }> = {
  recording: { label: 'gravando', color: 'var(--color-danger)' },
  transcribing: { label: 'transcrevendo', color: 'var(--color-warning)' },
  diarizing: { label: 'identificando vozes', color: 'var(--color-warning)' },
  ready: { label: 'pronta', color: 'var(--color-info)' },
  extracted: { label: 'extraída', color: 'var(--color-success)' },
  failed: { label: 'falhou', color: 'var(--color-text-dim)' },
}
