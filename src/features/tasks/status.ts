import type { TaskParentType, TaskPriority, TaskStatus } from '../../../shared/types/ipc'

// Cor (var CSS) + label pt-BR por status/prioridade. Mesmo padrão de
// objectives/status.ts e features/status.ts: cores reaproveitam o design
// system (info, warning, danger, success, text-dim).
export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: 'a fazer', color: 'var(--color-info)' },
  in_progress: { label: 'em andamento', color: 'var(--color-warning)' },
  blocked: { label: 'bloqueada', color: 'var(--color-danger)' },
  done: { label: 'concluída', color: 'var(--color-success)' },
  cancelled: { label: 'cancelada', color: 'var(--color-text-dim)' },
}

export const TASK_STATUS_ORDER: TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
]

export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  high: { label: 'alta', color: 'var(--color-danger)' },
  medium: { label: 'média', color: 'var(--color-warning)' },
  low: { label: 'baixa', color: 'var(--color-info)' },
}

// Ordem de exibição/ordenação: mais urgente primeiro.
export const PRIORITY_ORDER: TaskPriority[] = ['high', 'medium', 'low']

export const PARENT_TYPE_META: Record<TaskParentType, { label: string }> = {
  objective: { label: 'objetivo' },
  key_result: { label: 'KR' },
  feature: { label: 'feature' },
}
