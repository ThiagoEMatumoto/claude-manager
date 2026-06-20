import type { CalendarEvent } from './ics-parser'

// Seleção PURA (testável, sem relógio nem rede) do evento que está "começando
// agora": tem link do Google Meet E o DTSTART cai numa janela ±windowMs em torno
// de `now`. Critérios de notificação de ativação assistida.

// ±2min é a janela default: cobre o caso típico de o usuário ver a notificação
// no minuto que antecede a reunião e logo após o horário marcado, sem disparar
// cedo demais nem perder o início.
export const DEFAULT_WINDOW_MS = 2 * 60 * 1000

export interface ActiveEventResult {
  event: CalendarEvent
  // Chave estável de dedupe: une UID ao instante de início, pra que a MESMA
  // ocorrência não notifique 2x entre polls, mas uma recorrência futura (mesmo
  // UID, outro DTSTART) ainda notifique.
  dedupeKey: string
}

export function dedupeKey(event: CalendarEvent): string {
  const uid = event.uid ?? `${event.summary ?? ''}|${event.meetUrl ?? ''}`
  return `${uid}@${event.startMs ?? 'no-start'}`
}

function isWithinStartWindow(event: CalendarEvent, now: number, windowMs: number): boolean {
  if (event.startMs === null) return false
  return Math.abs(event.startMs - now) <= windowMs
}

// Eventos elegíveis (com Meet + dentro da janela), ordenados pelo início mais
// próximo de `now` primeiro — o chamador normalmente notifica o primeiro.
export function findActiveMeetEvents(
  events: CalendarEvent[],
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): ActiveEventResult[] {
  return events
    .filter((e) => e.meetUrl !== null && isWithinStartWindow(e, now, windowMs))
    .sort((a, b) => Math.abs((a.startMs ?? 0) - now) - Math.abs((b.startMs ?? 0) - now))
    .map((event) => ({ event, dedupeKey: dedupeKey(event) }))
}
