import { ipcMain } from 'electron'
import * as meetingStore from '../services/meeting-store'
import { broadcast } from '../services/notify'
import type {
  CreateMeetingInput,
  Meeting,
  MeetingListFilter,
  MeetingSegment,
  UpdateMeetingInput,
} from '../../../shared/types/ipc'

// CRUD da entidade Reuniões (Meeting Intelligence), molde fino do ipc/tasks:
// handlers store→broadcast. start/stop-capture, extract e materialize entram no
// increment do sidecar — aqui é só a espinha (CRUD + notas + segments).
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
}
