import { Notification } from 'electron'
import { getPref } from '../prefs-store'
import { getMainWindow } from '../notifications'
import { broadcast } from '../notify'
import { parseIcs } from './ics-parser'
import { findActiveMeetEvents, type ActiveEventResult } from './detect-active-event'
import type { MeetingActivationDraft } from '../../../../shared/types/ipc'

// Watcher de ativação assistida: faz poll de uma URL secreta iCal/ICS (o "Endereço
// secreto em formato iCal" do Google Calendar) e, quando um evento do Google Meet
// está começando AGORA (±2min), dispara uma notificação NATIVA. No clique: foca a
// janela e emite o draft pro renderer (área Reuniões + reunião pré-preenchida).
//
// Inativo quando a pref `meeting_calendar_ics_url` está vazia — sem erro, sem
// rede. Dedupe in-memory garante que a mesma ocorrência não notifique 2x entre
// polls. Espelha a estrutura start/stop dos outros serviços de boot (usage-monitor,
// feature-watcher) e o padrão de pref do meeting_sidecar_python.

export const MEETING_CALENDAR_ICS_URL_KEY = 'meeting_calendar_ics_url'

const POLL_INTERVAL_MS = 60 * 1000
// Timeout do fetch do feed: o ICS do Google é pequeno, mas a rede pode pendurar.
// Bounded pra nunca acumular requests sobrepostos se o servidor estiver lento.
const FETCH_TIMEOUT_MS = 20 * 1000

export interface CalendarWatcherDeps {
  // Lê a pref da URL (default: getPref). Injetável p/ teste.
  getIcsUrl?: () => string | null
  // Baixa o corpo do ICS de uma URL (default: fetch). Injetável p/ teste — assim
  // os testes nunca tocam a rede.
  fetchIcs?: (url: string) => Promise<string>
  // Dispara a notificação nativa (default: Electron Notification). Recebe o draft
  // pra montar título/corpo e o callback de clique. Injetável p/ teste.
  notify?: (draft: MeetingActivationDraft, onClick: () => void) => void
  // Relógio (default: Date.now). Injetável p/ teste determinístico.
  now?: () => number
}

async function defaultFetchIcs(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`calendar feed HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

// Notificação nativa + foco da janela e broadcast do draft no clique. Espelha o
// notify() de services/notifications.ts (mainWindow.show()/focus()), mas leva o
// usuário direto pra ativação da reunião em vez de só focar.
function defaultNotify(draft: MeetingActivationDraft, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const native = new Notification({
    title: 'Reunião começando agora',
    body: draft.title,
  })
  native.on('click', onClick)
  native.show()
}

function eventToDraft(found: ActiveEventResult): MeetingActivationDraft {
  const e = found.event
  return {
    title: e.summary?.trim() || 'Reunião',
    attendees: e.attendees,
    meetUrl: e.meetUrl,
    startMs: e.startMs,
  }
}

export class CalendarWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  // Chaves já notificadas — dedupe entre polls. Não persiste: reiniciar o app e
  // reativar uma reunião ainda em curso é comportamento aceitável (e raro).
  private readonly notified = new Set<string>()
  private polling = false
  private readonly deps: Required<CalendarWatcherDeps>

  constructor(deps: CalendarWatcherDeps = {}) {
    this.deps = {
      getIcsUrl: deps.getIcsUrl ?? (() => getPref<string | null>(MEETING_CALENDAR_ICS_URL_KEY, null)),
      fetchIcs: deps.fetchIcs ?? defaultFetchIcs,
      notify: deps.notify ?? defaultNotify,
      now: deps.now ?? (() => Date.now()),
    }
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    // Roda um poll imediato (não-bloqueante) + agenda o intervalo. unref pra não
    // segurar o event loop no quit.
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // Zera o dedupe sem mexer no timer — usado só por teste (restart() toca
  // Electron timers/getMainWindow, fora do escopo unitário do poll).
  notifiedClearForTest(): void {
    this.notified.clear()
  }

  // Reage à mudança da pref: parar+iniciar é idempotente e cobre os 3 casos
  // (vazia→preenchida liga; preenchida→vazia desliga no próximo poll; troca de
  // URL limpa o dedupe da URL anterior). Chamado pelo IPC de prefs no set.
  restart(): void {
    this.notified.clear()
    this.stop()
    this.start()
  }

  // Um ciclo: lê a pref, baixa o feed, detecta evento ativo, notifica (dedupe).
  // Nunca lança — erros de rede/parse são logados e o próximo poll tenta de novo.
  // Skip reentrante: se um poll ainda está em voo (rede lenta), o tick é ignorado.
  async poll(): Promise<void> {
    if (this.polling) return
    const url = (this.deps.getIcsUrl() ?? '').trim()
    if (!url) return // pref vazia → watcher inativo, sem erro.
    this.polling = true
    try {
      const raw = await this.deps.fetchIcs(url)
      const events = parseIcs(raw)
      const active = findActiveMeetEvents(events, this.deps.now())
      for (const found of active) {
        if (this.notified.has(found.dedupeKey)) continue
        this.notified.add(found.dedupeKey)
        const draft = eventToDraft(found)
        this.deps.notify(draft, () => this.activate(draft))
      }
    } catch (err) {
      console.warn(
        '[calendar-watcher] poll falhou (não-fatal):',
        String((err as Error)?.message ?? err),
      )
    } finally {
      this.polling = false
    }
  }

  // Clique na notificação: foca a janela e emite o draft pro renderer navegar à
  // área Reuniões e pré-preencher a nova reunião. Público p/ teste do efeito.
  activate(draft: MeetingActivationDraft): void {
    const win = getMainWindow()
    win?.show()
    win?.focus()
    broadcast('meeting:calendar:activate', draft)
  }
}

export const calendarWatcher = new CalendarWatcher()
