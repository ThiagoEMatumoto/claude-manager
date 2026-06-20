import { ipcMain } from 'electron'
import * as meetingStore from '../services/meeting-store'
import * as taskStore from '../services/task-store'
import * as objectiveStore from '../services/objective-store'
import * as featureStore from '../services/feature-store'
import { broadcast } from '../services/notify'
import { meetingSidecarManager, isMeetingSidecarConfigured } from '../services/meeting-sidecar'
import { extractMeeting, type ProviderPref } from '../services/meeting-extraction'
import { getPref } from '../services/prefs-store'
import type {
  CreateMeetingInput,
  Meeting,
  MeetingExtractResult,
  MeetingListFilter,
  MeetingSearchMatch,
  MeetingSegment,
  MaterializeMeetingTaskInput,
  Task,
  UpdateMeetingInput,
} from '../../../shared/types/ipc'

// CRUD + controle de captura da entidade Reuniões (Meeting Intelligence), molde
// fino do ipc/tasks: handlers store→broadcast. start/stop-capture supervisionam
// o sidecar (spawn NDJSON). extract e materialize entram em increments seguintes.
export function registerMeetingsIpc(): void {
  ipcMain.handle('meetings:list', (_e, filter?: MeetingListFilter): Meeting[] => {
    return meetingStore.list(filter)
  })

  ipcMain.handle('meetings:get', (_e, id: string): Meeting | null => {
    return meetingStore.get(id)
  })

  ipcMain.handle('meetings:create', (_e, input: CreateMeetingInput): Meeting => {
    const meeting = meetingStore.create(input)
    broadcast('meeting:updated', meeting)
    return meeting
  })

  ipcMain.handle('meetings:update', (_e, input: UpdateMeetingInput): Meeting => {
    const meeting = meetingStore.update(input)
    broadcast('meeting:updated', meeting)
    return meeting
  })

  ipcMain.handle('meetings:delete', (_e, id: string): void => {
    meetingStore.remove(id)
    broadcast('meeting:updated', { id, deleted: true })
  })

  ipcMain.handle('meetings:list-segments', (_e, meetingId: string): MeetingSegment[] => {
    return meetingStore.listSegments(meetingId)
  })

  // Busca FTS5 entre reuniões (transcript + notas aumentadas + extrações).
  // Devolve reuniões com snippet/origem do match, ordenadas por relevância.
  ipcMain.handle('meetings:search', (_e, query: string): MeetingSearchMatch[] => {
    return meetingStore.searchMeetings(query)
  })

  // Sidecar REAL de transcrição configurado? (pref `meeting_sidecar_python` +
  // python + sidecar.py existem). A UI usa pra mostrar o aviso de 1ª classe
  // "rode scripts/setup-meeting-sidecar.sh" sem bloquear notas/extração.
  ipcMain.handle('meetings:sidecar-configured', (): boolean => {
    return isMeetingSidecarConfigured()
  })

  // Captura: o sidecar emite o `status: 'capturing'` ao subir; aqui só carimbamos
  // started_at e disparamos o spawn. O broadcast de status final vem do sidecar.
  ipcMain.handle('meetings:start-capture', async (_e, meetingId: string): Promise<void> => {
    const meeting = meetingStore.update({
      id: meetingId,
      status: 'capturing',
      startedAt: Date.now(),
    })
    broadcast('meeting:updated', meeting)
    await meetingSidecarManager.start(meetingId)
  })

  // Stop graceful (SIGINT → timeout → SIGKILL). O sidecar emite `done`/`status`
  // ao encerrar; a reconciliação no exit cobre morte anômala.
  ipcMain.handle('meetings:stop-capture', (_e, meetingId: string): void => {
    meetingSidecarManager.stop(meetingId)
  })

  // Extração (coração): transcript + notas → claude -p → notas aumentadas +
  // itens com quote/grounding. Injeta objetivos/features ativos como referência
  // pro modelo SUGERIR vínculos (decisão final é humana na ExtractionReview).
  ipcMain.handle('meetings:extract', async (_e, meetingId: string): Promise<MeetingExtractResult> => {
    const objectives = objectiveStore.list().map((o) => ({ id: o.id, title: o.title }))
    const features = featureStore.list().map((f) => ({ id: f.id, title: f.title }))
    // Seleção de provedor via app_prefs (mesmo padrão de claude_command):
    //  - meeting_private_mode (bool): força Ollama, zero saída de processo claude;
    //  - meeting_extractor_provider ('claude'|'ollama'|'auto', default 'auto').
    // Modo privado vence a pref de provedor.
    const privateMode = getPref<boolean>('meeting_private_mode', false)
    const providerPref: ProviderPref = privateMode
      ? 'ollama'
      : getPref<ProviderPref>('meeting_extractor_provider', 'auto')
    const ollamaHost = getPref<string | null>('meeting_ollama_host', null)
    const ollamaModel = getPref<string | null>('meeting_ollama_model', null)
    // DI: injeta o store real (este handler já roda em contexto Electron).
    // meeting-extraction NÃO importa meeting-store — evita o require lazy que o
    // electron-vite não inlina (Cannot find module './meeting-store' no build).
    const result = await extractMeeting(meetingId, {
      store: meetingStore,
      objectives,
      features,
      providerPref,
      ollama: {
        host: ollamaHost ?? undefined,
        model: ollamaModel ?? undefined,
      },
    })
    const meeting = meetingStore.get(meetingId)
    if (meeting) broadcast('meeting:updated', meeting)
    return {
      summary: result.summary,
      augmentedNotes: result.augmentedNotes,
      extractions: result.extractions,
    }
  })

  // Materializa uma extração revisada como task real, linkada a objective/
  // feature, com a quote+timestamp na descrição. Idempotente: grava
  // materialized_task_id pra re-aprovar não duplicar.
  ipcMain.handle(
    'meetings:materialize-task',
    (_e, input: MaterializeMeetingTaskInput): Task => {
      // Idempotência real: se a extração já foi materializada, devolve a task
      // existente em vez de criar uma 2ª (o usuário pode re-aprovar o mesmo item).
      if (input.extractionId) {
        const existing = meetingStore.getExtraction(input.extractionId)
        if (existing?.materializedTaskId) {
          const task = taskStore.get(existing.materializedTaskId)
          if (task) return task
        }
      }

      const ts = formatTimestamp(input.startMs)
      const provenance = [
        input.quote ? `> ${input.quote}` : null,
        input.speakerLabel || ts ? `— ${[input.speakerLabel, ts].filter(Boolean).join(' @ ')}` : null,
      ]
        .filter(Boolean)
        .join('\n')
      const description = [input.description?.trim() || null, provenance || null]
        .filter(Boolean)
        .join('\n\n')

      const task = taskStore.create({
        title: input.title.trim(),
        description: description || null,
        priority: input.priority ?? null,
        tags: ['meeting', 'auto'],
        links: input.link ? [input.link] : [],
      })

      if (input.extractionId) {
        meetingStore.markExtractionMaterialized(input.extractionId, task.id)
      }
      broadcast('task:updated', { id: task.id })
      for (const objId of taskStore.affectedObjectiveIds(task.links)) {
        broadcast('objective:updated', { id: objId })
      }
      return task
    },
  )
}

function formatTimestamp(startMs: number | null | undefined): string | null {
  if (startMs == null || !Number.isFinite(startMs) || startMs < 0) return null
  const totalSeconds = Math.floor(startMs / 1000)
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
