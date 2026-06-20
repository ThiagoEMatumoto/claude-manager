import { ipcMain } from 'electron'
import * as meetingStore from '../services/meeting-store'
import { broadcast } from '../services/notify'
import { meetingSidecarManager } from '../services/meeting-sidecar'
import type {
  CreateMeetingInput,
  Meeting,
  MeetingListFilter,
  MeetingSegment,
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
}
