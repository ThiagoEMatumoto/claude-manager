import type { FeatureStatus } from '../../../shared/types/ipc'

// Cor (var CSS) + label pt-BR por status. Cores reaproveitam o design system:
// warning (laranja-âmbar), success (verde), text-dim (cinza neutro).
export const STATUS_META: Record<FeatureStatus, { label: string; color: string }> = {
  pending: { label: 'pendente', color: 'var(--color-text-dim)' },
  'in-progress': { label: 'em andamento', color: 'var(--color-warning)' },
  blocked: { label: 'bloqueada', color: 'var(--color-danger)' },
  done: { label: 'concluída', color: 'var(--color-success)' },
  paused: { label: 'pausada', color: 'var(--color-text-dim)' },
}

export const STATUS_ORDER: FeatureStatus[] = [
  'in-progress',
  'pending',
  'blocked',
  'paused',
  'done',
]
