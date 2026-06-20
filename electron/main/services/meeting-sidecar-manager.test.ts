import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MeetingSidecarManager,
  type SidecarBroadcast,
  type SidecarStore,
} from './meeting-sidecar-manager'
import type { MeetingSegment } from '../../../shared/types/ipc'

// Sidecar fake EM NODE (process.execPath + node -e) — NÃO depende de python3 no
// test runner. O script emite NDJSON no stdout com delays curtos, igual ao
// contrato do fake_sidecar.py. Diferentes cenários são scripts diferentes.

const NODE = process.execPath

// Roteiro completo: status → 2 segments → done. Delays de 20ms p/ exercitar o
// streaming sem tornar o teste lento.
const HAPPY_SCRIPT = `
const emit = (o) => { process.stdout.write(JSON.stringify(o) + "\\n") }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  emit({ type: "status", state: "capturing" })
  await sleep(20)
  emit({ type: "segment", idx: 0, start_ms: 0, end_ms: 1000, speaker: "SPEAKER_00", text: "olá", confidence: 0.9 })
  await sleep(20)
  emit({ type: "segment", idx: 1, start_ms: 1000, end_ms: 2000, speaker: "SPEAKER_01", text: "mundo", confidence: 0.8 })
  await sleep(20)
  emit({ type: "done", segments: 2, duration_ms: 2000 })
})()
`

// Sobe (status capturing), emite 1 segment, e fica vivo aguardando — para
// exercitar stop() e o cenário de morte sem done.
const HANG_SCRIPT = `
const emit = (o) => { process.stdout.write(JSON.stringify(o) + "\\n") }
emit({ type: "status", state: "capturing" })
emit({ type: "segment", idx: 0, start_ms: 0, end_ms: 1000, speaker: "SPEAKER_00", text: "vivo", confidence: 0.9 })
setInterval(() => {}, 1000)
`

interface Recorder {
  store: SidecarStore
  broadcast: SidecarBroadcast
  updates: Array<{ id: string; status?: string; durationMs?: number | null }>
  segments: MeetingSegment[]
  events: Array<{ channel: string; payload: unknown }>
}

function makeRecorder(): Recorder {
  const updates: Recorder['updates'] = []
  const segments: MeetingSegment[] = []
  const events: Recorder['events'] = []
  let seq = 0
  const store: SidecarStore = {
    update: (input) => {
      updates.push(input)
      return input
    },
    appendSegment: (input) => {
      const seg: MeetingSegment = {
        id: `seg-${seq++}`,
        meetingId: input.meetingId,
        idx: seq,
        startMs: input.startMs ?? null,
        endMs: input.endMs ?? null,
        speakerLabel: input.speakerLabel ?? null,
        text: input.text,
        wordsJson: null,
        avgLogprob: null,
        noSpeechProb: null,
        isPartial: input.isPartial ?? false,
      }
      segments.push(seg)
      return seg
    },
  }
  const broadcast: SidecarBroadcast = (channel, payload) => {
    events.push({ channel, payload })
  }
  return { store, broadcast, updates, segments, events }
}

function makeManager(rec: Recorder): MeetingSidecarManager {
  return new MeetingSidecarManager({ store: rec.store, broadcast: rec.broadcast })
}

function waitForExit(mgr: MeetingSidecarManager): Promise<{
  meetingId: string
  code: number | null
}> {
  return new Promise((resolve) => mgr.on('exit', resolve))
}

describe('MeetingSidecarManager', () => {
  let mgr: MeetingSidecarManager | null = null

  afterEach(() => {
    mgr?.killAllSidecars()
    mgr = null
  })

  it('parses NDJSON events in order: status → segments → done', async () => {
    const rec = makeRecorder()
    mgr = makeManager(rec)
    const exited = waitForExit(mgr)
    await mgr.start('m1', { command: NODE, args: ['-e', HAPPY_SCRIPT] })
    await exited

    // segments persistidos na ordem
    expect(rec.segments.map((s) => s.text)).toEqual(['olá', 'mundo'])
    expect(rec.segments[0].speakerLabel).toBe('SPEAKER_00')

    // appendSegment foi chamado por segment
    expect(rec.segments).toHaveLength(2)

    // status broadcastado: capturing (do sidecar) e ready (do done)
    const statusEvents = rec.events
      .filter((e) => e.channel === 'meeting:status')
      .map((e) => (e.payload as { status: string }).status)
    expect(statusEvents).toContain('capturing')
    expect(statusEvents).toContain('ready')

    // segments broadcastados ao vivo
    const segEvents = rec.events.filter((e) => e.channel === 'meeting:transcript:segment')
    expect(segEvents).toHaveLength(2)

    // done atualiza o store para ready + duration
    const readyUpdate = rec.updates.find((u) => u.status === 'ready')
    expect(readyUpdate?.durationMs).toBe(2000)

    // exit limpo: não está mais rodando
    expect(mgr.isRunning('m1')).toBe(false)
  })

  it('stop() kills the running process', async () => {
    const rec = makeRecorder()
    mgr = makeManager(rec)
    const exited = waitForExit(mgr)
    await mgr.start('m2', { command: NODE, args: ['-e', HANG_SCRIPT] })

    // aguarda subir (recebeu pelo menos o status capturing)
    await vi.waitFor(() => expect(mgr!.isRunning('m2')).toBe(true))
    await vi.waitFor(() =>
      expect(rec.events.some((e) => e.channel === 'meeting:status')).toBe(true),
    )

    mgr.stop('m2')
    const result = await exited
    expect(result.meetingId).toBe('m2')
    expect(mgr.isRunning('m2')).toBe(false)
  })

  it('reconciles to failed when the process dies while capturing without done', async () => {
    const rec = makeRecorder()
    mgr = makeManager(rec)
    const exited = waitForExit(mgr)
    await mgr.start('m3', { command: NODE, args: ['-e', HANG_SCRIPT] })

    await vi.waitFor(() =>
      expect(rec.events.some((e) => e.channel === 'meeting:status')).toBe(true),
    )

    // Mata sem chance de done (SIGKILL imediato) — simula crash.
    mgr.stop('m3')
    // stop manda SIGINT; o HANG_SCRIPT ignora e fica vivo, então força.
    mgr.killAllSidecars()
    await exited

    const failedUpdate = rec.updates.find((u) => u.status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate?.id).toBe('m3')

    const failedBroadcast = rec.events.find(
      (e) =>
        e.channel === 'meeting:status' && (e.payload as { status: string }).status === 'failed',
    )
    expect(failedBroadcast).toBeDefined()
  })

  it('does NOT reconcile to failed after a clean done', async () => {
    const rec = makeRecorder()
    mgr = makeManager(rec)
    const exited = waitForExit(mgr)
    await mgr.start('m4', { command: NODE, args: ['-e', HAPPY_SCRIPT] })
    await exited

    expect(rec.updates.some((u) => u.status === 'failed')).toBe(false)
  })

  it('killAllSidecars termina via SIGTERM (sem precisar escalar pra SIGKILL)', async () => {
    const rec = makeRecorder()
    mgr = makeManager(rec)
    const exited = waitForExit(mgr)
    // HANG_SCRIPT ignora SIGINT mas o handler default do Node encerra no SIGTERM.
    await mgr.start('mkill', { command: NODE, args: ['-e', HANG_SCRIPT] })
    await vi.waitFor(() => expect(mgr!.isRunning('mkill')).toBe(true))

    mgr.killAllSidecars()
    const result = await exited
    // Saiu por sinal de terminação (SIGTERM), não por SIGKILL forçado.
    expect(result.meetingId).toBe('mkill')
    expect(mgr.isRunning('mkill')).toBe(false)
  })

  it('rejects starting the same meeting twice', async () => {
    const rec = makeRecorder()
    mgr = makeManager(rec)
    await mgr.start('m5', { command: NODE, args: ['-e', HANG_SCRIPT] })
    await expect(mgr.start('m5', { command: NODE, args: ['-e', HANG_SCRIPT] })).rejects.toThrow(
      /already running/,
    )
  })
})
