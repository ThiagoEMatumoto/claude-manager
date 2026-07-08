import type { JobSchedule } from '../../../shared/types/ipc'

// 0=domingo..6=sábado (mesma convenção de Date.getDay e de computeNextRunAt).
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function hhmm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`
}

// JobSchedule (discriminated union) → texto legível pt-BR pra sidebar/detalhe.
// Puro → testável. Espelha os 3 tipos do agendamento (interval/daily/weekly).
export function formatSchedule(schedule: JobSchedule): string {
  switch (schedule.type) {
    case 'interval': {
      const hours = Math.max(1, Math.floor(schedule.hours))
      return `A cada ${hours}h`
    }
    case 'daily':
      return `Todo dia ${hhmm(schedule.hour, schedule.minute)}`
    case 'weekly':
      return `Toda ${WEEKDAYS[schedule.dayOfWeek] ?? 'semana'} ${hhmm(schedule.hour, schedule.minute)}`
  }
}
