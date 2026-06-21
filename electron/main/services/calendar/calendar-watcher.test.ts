import { describe, it, expect, vi } from 'vitest'

// Mock do electron: o módulo importa Notification (defaultNotify) e BrowserWindow
// (via notify.broadcast/notifications.getMainWindow). Os testes injetam notify
// próprio, então estes só precisam existir pra o import resolver fora do Electron.
vi.mock('electron', () => ({
  Notification: Object.assign(
    class {
      on() {}
      show() {}
    },
    { isSupported: () => false },
  ),
  BrowserWindow: { getAllWindows: () => [] },
}))

import { CalendarWatcher } from './calendar-watcher'
import type { MeetingActivationDraft } from '../../../../shared/types/ipc'

const NOW = Date.UTC(2026, 5, 20, 14, 30, 0)

function icsWithMeet(opts: { uid?: string; startMs: number; summary?: string }): string {
  const stamp = new Date(opts.startMs)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `UID:${opts.uid ?? 'uid-1'}`,
    `DTSTART:${stamp}`,
    `SUMMARY:${opts.summary ?? 'Daily'}`,
    'LOCATION:https://meet.google.com/abc-defg-hij',
    'ATTENDEE:mailto:ana@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

interface Captured {
  notified: MeetingActivationDraft[]
  fire: () => void // dispara o onClick da última notificação
}

function makeWatcher(over: {
  url?: string | null
  ics?: string
  fetchIcs?: () => Promise<string>
}): { watcher: CalendarWatcher; cap: Captured } {
  const cap: Captured = { notified: [], fire: () => {} }
  const watcher = new CalendarWatcher({
    getIcsUrl: () => (over.url === undefined ? 'https://secret/feed.ics' : over.url),
    fetchIcs: over.fetchIcs ?? (async () => over.ics ?? icsWithMeet({ startMs: NOW })),
    notify: (draft, onClick) => {
      cap.notified.push(draft)
      cap.fire = onClick
    },
    now: () => NOW,
  })
  return { watcher, cap }
}

describe('CalendarWatcher.poll', () => {
  it('pref vazia → não baixa nem notifica', async () => {
    const fetchIcs = vi.fn(async () => icsWithMeet({ startMs: NOW }))
    const { watcher, cap } = makeWatcher({ url: '', fetchIcs })
    await watcher.poll()
    expect(fetchIcs).not.toHaveBeenCalled()
    expect(cap.notified).toHaveLength(0)
  })

  it('pref null → inativo', async () => {
    const fetchIcs = vi.fn(async () => icsWithMeet({ startMs: NOW }))
    const { watcher } = makeWatcher({ url: null, fetchIcs })
    await watcher.poll()
    expect(fetchIcs).not.toHaveBeenCalled()
  })

  it('notifica evento do Meet começando agora, com draft preenchido', async () => {
    const { watcher, cap } = makeWatcher({ ics: icsWithMeet({ startMs: NOW + 30_000 }) })
    await watcher.poll()
    expect(cap.notified).toHaveLength(1)
    expect(cap.notified[0]).toEqual({
      title: 'Daily',
      attendees: ['ana@example.com'],
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      startMs: NOW + 30_000,
    })
  })

  it('dedupe: a mesma ocorrência não notifica 2x entre polls', async () => {
    const { watcher, cap } = makeWatcher({ ics: icsWithMeet({ startMs: NOW }) })
    await watcher.poll()
    await watcher.poll()
    expect(cap.notified).toHaveLength(1)
  })

  it('não notifica evento sem Meet nem fora da janela', async () => {
    const noMeet = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      `DTSTART:${new Date(NOW).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      'SUMMARY:Presencial',
      'LOCATION:Sala 3',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const { watcher, cap } = makeWatcher({ ics: noMeet })
    await watcher.poll()
    expect(cap.notified).toHaveLength(0)
  })

  it('erro de fetch é não-fatal (não lança)', async () => {
    const { watcher, cap } = makeWatcher({
      fetchIcs: async () => {
        throw new Error('network down')
      },
    })
    await expect(watcher.poll()).resolves.toBeUndefined()
    expect(cap.notified).toHaveLength(0)
  })

  it('restart limpa o dedupe (nova ocorrência re-notifica)', async () => {
    const { watcher, cap } = makeWatcher({ ics: icsWithMeet({ startMs: NOW }) })
    await watcher.poll()
    expect(cap.notified).toHaveLength(1)
    watcher.notifiedClearForTest()
    await watcher.poll()
    expect(cap.notified).toHaveLength(2)
    watcher.stop()
  })
})
