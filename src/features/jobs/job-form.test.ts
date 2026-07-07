import { describe, expect, it } from 'vitest'
import {
  buildCreateInput,
  buildSchedule,
  DEFAULT_SCHEDULE_FORM,
  scheduleToForm,
  type JobFormValues,
} from './job-form'

describe('buildSchedule', () => {
  it('interval clampa hours < 1 pra 1', () => {
    expect(buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'interval', hours: 6 })).toEqual({
      type: 'interval',
      hours: 6,
    })
    expect(buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'interval', hours: 0 })).toEqual({
      type: 'interval',
      hours: 1,
    })
  })

  it('daily monta hora/minuto', () => {
    expect(buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'daily', hour: 18, minute: 30 })).toEqual({
      type: 'daily',
      hour: 18,
      minute: 30,
    })
  })

  it('weekly monta dia/hora/minuto', () => {
    expect(
      buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'weekly', dayOfWeek: 3, hour: 9, minute: 5 }),
    ).toEqual({ type: 'weekly', dayOfWeek: 3, hour: 9, minute: 5 })
  })

  it('coage NaN (input vazio) pro default do campo em vez de Invalid Date', () => {
    expect(buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'interval', hours: NaN })).toEqual({
      type: 'interval',
      hours: 24,
    })
    expect(
      buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'daily', hour: NaN, minute: NaN }),
    ).toEqual({ type: 'daily', hour: 9, minute: 0 })
  })

  it('clampa hora/minuto/dia fora do range', () => {
    expect(
      buildSchedule({ ...DEFAULT_SCHEDULE_FORM, type: 'weekly', dayOfWeek: 9, hour: 30, minute: 90 }),
    ).toEqual({ type: 'weekly', dayOfWeek: 6, hour: 23, minute: 59 })
  })
})

describe('scheduleToForm', () => {
  it('round-trip preserva o tipo e seus campos', () => {
    expect(scheduleToForm({ type: 'daily', hour: 7, minute: 15 })).toMatchObject({
      type: 'daily',
      hour: 7,
      minute: 15,
    })
    expect(scheduleToForm({ type: 'interval', hours: 12 })).toMatchObject({
      type: 'interval',
      hours: 12,
    })
  })
})

describe('buildCreateInput', () => {
  const base: JobFormValues = {
    name: '  Nightly review  ',
    repoId: 'repo-1',
    prompt: '  critique the diff  ',
    schedule: { type: 'interval', hours: 6 },
    catchUp: false,
    model: '',
    effort: '',
    permissionMode: 'plan',
    advisorModel: '',
  }

  it('trima name/prompt e converte overrides vazios em null', () => {
    expect(buildCreateInput(base)).toEqual({
      name: 'Nightly review',
      repoId: 'repo-1',
      prompt: 'critique the diff',
      schedule: { type: 'interval', hours: 6 },
      catchUp: false,
      model: null,
      effort: null,
      permissionMode: 'plan',
      advisorModel: null,
    })
  })

  it('propaga catchUp quando ligado', () => {
    expect(buildCreateInput({ ...base, catchUp: true })).toMatchObject({ catchUp: true })
  })

  it('preserva overrides preenchidos e repoId null (avulso)', () => {
    expect(
      buildCreateInput({
        ...base,
        repoId: null,
        model: 'opus',
        effort: 'high',
        permissionMode: 'acceptEdits',
        advisorModel: 'sonnet',
      }),
    ).toMatchObject({
      repoId: null,
      model: 'opus',
      effort: 'high',
      permissionMode: 'acceptEdits',
      advisorModel: 'sonnet',
    })
  })
})
