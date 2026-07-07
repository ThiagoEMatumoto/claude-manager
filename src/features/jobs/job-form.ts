import type {
  AdvisorModel,
  CreateScheduledJobInput,
  EffortLevel,
  JobSchedule,
  PermissionMode,
} from '../../../shared/types/ipc'

// Lógica pura do JobDialog: estado do form ⇄ JobSchedule/CreateScheduledJobInput.
// Separado do componente pra ser testável sem DOM.

export type ScheduleType = 'interval' | 'daily' | 'weekly'

// Um único estado carrega os campos dos 3 tipos; buildSchedule só lê os do tipo
// ativo. Trocar de tipo preserva o que o usuário já digitou nos outros.
export interface ScheduleFormState {
  type: ScheduleType
  hours: number
  hour: number
  minute: number
  dayOfWeek: number
}

export const DEFAULT_SCHEDULE_FORM: ScheduleFormState = {
  type: 'interval',
  hours: 24,
  hour: 9,
  minute: 0,
  dayOfWeek: 1,
}

// Inputs numéricos vazios viram NaN — cai no default do campo em vez de propagar
// NaN pro schedule (que renderizaria "Invalid Date" no preview).
function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Math.floor(finite(n, fallback))))
}

// Estado do form → JobSchedule (discriminated union), com clamping defensivo
// (mesma invariante de computeNextRunAt: hours >= 1; hora/minuto/dia válidos).
export function buildSchedule(s: ScheduleFormState): JobSchedule {
  switch (s.type) {
    case 'interval':
      return { type: 'interval', hours: Math.max(1, Math.floor(finite(s.hours, DEFAULT_SCHEDULE_FORM.hours))) }
    case 'daily':
      return { type: 'daily', hour: clamp(s.hour, 0, 23, 9), minute: clamp(s.minute, 0, 59, 0) }
    case 'weekly':
      return {
        type: 'weekly',
        dayOfWeek: clamp(s.dayOfWeek, 0, 6, 1),
        hour: clamp(s.hour, 0, 23, 9),
        minute: clamp(s.minute, 0, 59, 0),
      }
  }
}

// JobSchedule → estado do form (modo editar). Preenche o campo do tipo vindo e
// mantém os demais nos defaults.
export function scheduleToForm(schedule: JobSchedule): ScheduleFormState {
  switch (schedule.type) {
    case 'interval':
      return { ...DEFAULT_SCHEDULE_FORM, type: 'interval', hours: schedule.hours }
    case 'daily':
      return { ...DEFAULT_SCHEDULE_FORM, type: 'daily', hour: schedule.hour, minute: schedule.minute }
    case 'weekly':
      return {
        ...DEFAULT_SCHEDULE_FORM,
        type: 'weekly',
        dayOfWeek: schedule.dayOfWeek,
        hour: schedule.hour,
        minute: schedule.minute,
      }
  }
}

// Valores brutos dos controles ('' = sem override, vira null no input do store).
export interface JobFormValues {
  name: string
  repoId: string | null
  prompt: string
  schedule: JobSchedule
  // Opt-in de catch-up: recupera execuções perdidas ao abrir o app (senão a run
  // vencida com o app fechado é marcada 'missed' — skip-with-marker).
  catchUp: boolean
  model: string
  effort: '' | EffortLevel
  permissionMode: PermissionMode
  advisorModel: '' | AdvisorModel
}

// Form → CreateScheduledJobInput. Também serve pro update (spread + id): os
// campos de Create são assignáveis aos supersets opcionais de Update.
export function buildCreateInput(v: JobFormValues): CreateScheduledJobInput {
  return {
    name: v.name.trim(),
    repoId: v.repoId,
    prompt: v.prompt.trim(),
    schedule: v.schedule,
    catchUp: v.catchUp,
    model: v.model || null,
    effort: v.effort || null,
    permissionMode: v.permissionMode,
    advisorModel: v.advisorModel || null,
  }
}
