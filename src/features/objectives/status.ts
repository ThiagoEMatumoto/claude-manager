import type {
  KeyResultStatus,
  ObjectiveKind,
  ObjectiveStatus,
  ProgressDirection,
  ProgressMode,
} from '../../../shared/types/ipc'

// Cor (var CSS) + label pt-BR por status/kind. Mesmo padrão de features/status.ts:
// cores reaproveitam o design system (warning, success, danger, info, text-dim).
export const STATUS_META: Record<ObjectiveStatus, { label: string; color: string }> = {
  active: { label: 'ativo', color: 'var(--color-warning)' },
  paused: { label: 'pausado', color: 'var(--color-text-dim)' },
  done: { label: 'concluído', color: 'var(--color-success)' },
  archived: { label: 'arquivado', color: 'var(--color-text-dim)' },
}

export const STATUS_ORDER: ObjectiveStatus[] = ['active', 'paused', 'done', 'archived']

export const KIND_META: Record<ObjectiveKind, { label: string; color: string }> = {
  okr: { label: 'OKR', color: 'var(--color-accent)' },
  personal_goal: { label: 'meta pessoal', color: 'var(--color-info)' },
  project: { label: 'projeto', color: 'var(--color-success)' },
  custom: { label: 'custom', color: 'var(--color-text-dim)' },
}

export const KIND_ORDER: ObjectiveKind[] = ['okr', 'personal_goal', 'project', 'custom']

export const KR_STATUS_META: Record<KeyResultStatus, { label: string; color: string }> = {
  active: { label: 'ativo', color: 'var(--color-warning)' },
  paused: { label: 'pausado', color: 'var(--color-text-dim)' },
  done: { label: 'concluído', color: 'var(--color-success)' },
  cancelled: { label: 'cancelado', color: 'var(--color-danger)' },
}

export const KR_STATUS_ORDER: KeyResultStatus[] = ['active', 'paused', 'done', 'cancelled']

export const PROGRESS_MODE_LABEL: Record<ProgressMode, string> = {
  auto_rollup: 'rollup automático',
  metric: 'métrica',
  manual: 'manual',
}

export const DIRECTION_LABEL: Record<ProgressDirection, string> = {
  increase: 'aumentar',
  decrease: 'reduzir',
  maintain: 'manter',
}

export const PRIORITY_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
}
