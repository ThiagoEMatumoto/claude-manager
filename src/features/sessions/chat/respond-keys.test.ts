import { describe, expect, it } from 'vitest'
import {
  buildDigitKey,
  buildOtherKeys,
  buildPlanKeys,
  buildReviewKeys,
  buildSelectKeys,
  buildTabKeys,
  buildToggleKeys,
  findManualApproveIndex,
  findReviewOptionIndex,
  playKeys,
} from './respond-keys'
import type { TuiMenu } from '../tui-menu-parser'

const DOWN = '\x1b[B'

describe('buildDigitKey', () => {
  it('turns a 0-based option index into the 1-based TUI digit', () => {
    expect(buildDigitKey(0)).toEqual(['1'])
    expect(buildDigitKey(2)).toEqual(['3'])
    expect(buildDigitKey(8)).toEqual(['9'])
  })

  it('fails closed outside the TUI digit handler range (1..9)', () => {
    expect(buildDigitKey(-1)).toEqual([])
    expect(buildDigitKey(9)).toEqual([])
    expect(buildDigitKey(1.5)).toEqual([])
  })

  it('never emits arrows or Enter (digit selects AND submits)', () => {
    const all = [buildDigitKey(0), buildDigitKey(4), buildDigitKey(8)].flat().join('')
    expect(all).not.toContain(DOWN)
    expect(all).not.toContain('\r')
  })
})

function planMenu(labels: string[]): TuiMenu {
  return {
    kind: 'plan',
    question: 'Would you like to proceed?',
    options: labels.map((label, index) => ({ index, label })),
    multiSelect: false,
  }
}

describe('findManualApproveIndex', () => {
  it('finds "Yes, manually approve edits" at any position', () => {
    expect(
      findManualApproveIndex(
        planMenu(['Yes, auto-accept edits', 'Yes, manually approve edits', 'No, keep planning']),
      ),
    ).toBe(1)
    expect(
      findManualApproveIndex(
        planMenu([
          'Yes, and bypass permissions',
          'Yes, auto-accept edits',
          'Yes, manually approve edits',
          'No, keep planning',
        ]),
      ),
    ).toBe(2)
  })

  it('never matches "Yes, auto-accept edits"', () => {
    expect(
      findManualApproveIndex(planMenu(['Yes, auto-accept edits', 'No, keep planning'])),
    ).toBeNull()
  })

  it('returns null for question menus', () => {
    const menu: TuiMenu = {
      kind: 'question',
      options: [{ index: 0, label: 'Yes, manually approve edits' }],
      multiSelect: false,
    }
    expect(findManualApproveIndex(menu)).toBeNull()
  })
})

describe('buildPlanKeys', () => {
  it('approves via the parsed manual-approve digit only', () => {
    expect(buildPlanKeys('approve', 1)).toEqual(['2'])
    expect(buildPlanKeys('approve', 2)).toEqual(['3'])
  })

  it('fails closed when the manual-approve option was not found', () => {
    expect(buildPlanKeys('approve', null)).toEqual([])
  })

  it('never approves with a blind Enter (would hit auto-accept edits)', () => {
    expect(buildPlanKeys('approve', 0).join('')).not.toContain('\r')
    expect(buildPlanKeys('approve', null).join('')).not.toContain('\r')
  })

  it('rejects with a single Esc (position-independent)', () => {
    expect(buildPlanKeys('reject', null)).toEqual(['\x1b'])
    expect(buildPlanKeys('reject', 1)).toEqual(['\x1b'])
  })
})

function questionMenu(overrides: Partial<TuiMenu> = {}): TuiMenu {
  return {
    kind: 'question',
    question: 'Qual fruta?',
    options: [
      { index: 0, label: 'Maçã' },
      { index: 1, label: 'Banana' },
    ],
    multiSelect: false,
    submitOnDigit: true,
    ...overrides,
  }
}

describe('buildSelectKeys — clique numa opção single-select', () => {
  it('single sem preview: só o dígito (comportamento pré-existente, seleciona E submete)', () => {
    expect(buildSelectKeys(questionMenu(), 0)).toEqual(['1'])
    expect(buildSelectKeys(questionMenu(), 1)).toEqual(['2'])
  })

  it('single COM preview/notes: dígito + Enter separado (submitOnDigit:false)', () => {
    const menu = questionMenu({ submitOnDigit: false })
    expect(buildSelectKeys(menu, 0)).toEqual(['1', '\r'])
  })

  it('fail-closed fora do range do handler de dígito', () => {
    expect(buildSelectKeys(questionMenu(), 9)).toEqual([])
    expect(buildSelectKeys(questionMenu({ submitOnDigit: false }), 9)).toEqual([])
  })
})

describe('buildToggleKeys — checkbox de multi-select', () => {
  it('dígito faz toggle, nunca Enter (submeter é só via aba Submit/revisão)', () => {
    expect(buildToggleKeys(0)).toEqual(['1'])
    expect(buildToggleKeys(2)).toEqual(['3'])
  })

  it('fail-closed fora do range', () => {
    expect(buildToggleKeys(9)).toEqual([])
  })
})

describe('buildTabKeys — navegação entre abas', () => {
  it('seta direita/esquerda, nunca outra coisa', () => {
    expect(buildTabKeys('next')).toEqual(['\x1b[C'])
    expect(buildTabKeys('prev')).toEqual(['\x1b[D'])
  })
})

describe('findReviewOptionIndex / buildReviewKeys — tela "Review your answers"', () => {
  const review: TuiMenu = {
    kind: 'question_review',
    question: 'Review your answers',
    options: [
      { index: 0, label: 'Submit answers' },
      { index: 1, label: 'Cancel' },
    ],
    multiSelect: false,
    submitOnDigit: true,
  }

  it('acha o índice certo por label (não por posição fixa)', () => {
    expect(findReviewOptionIndex(review, 'submit')).toBe(0)
    expect(findReviewOptionIndex(review, 'cancel')).toBe(1)
  })

  it('buildReviewKeys manda o dígito certo', () => {
    expect(buildReviewKeys(review, 'submit')).toEqual(['1'])
    expect(buildReviewKeys(review, 'cancel')).toEqual(['2'])
  })

  it('fail-closed fora do kind question_review ou sem a opção', () => {
    expect(findReviewOptionIndex(questionMenu(), 'submit')).toBeNull()
    expect(buildReviewKeys(questionMenu(), 'submit')).toEqual([])
  })
})

describe('buildOtherKeys — "Other" (texto livre)', () => {
  it('dígito seleciona a linha + texto digitado + Enter', () => {
    expect(buildOtherKeys(3, 'Neovim')).toEqual(['4', 'Neovim', '\r'])
  })

  it('fail-closed com texto vazio — NUNCA manda Enter sem texto (isso decline)', () => {
    expect(buildOtherKeys(3, '')).toEqual([])
  })

  it('fail-closed fora do range de dígito', () => {
    expect(buildOtherKeys(9, 'algo')).toEqual([])
  })
})

describe('playKeys', () => {
  it('interleaves writes with sleeps between chunks (never before the first)', async () => {
    const log: string[] = []
    const sleep = (ms: number) => {
      log.push(`sleep:${ms}`)
      return Promise.resolve()
    }
    await playKeys([DOWN, DOWN, '\r'], (s) => log.push(s), 30, sleep)
    expect(log).toEqual([DOWN, 'sleep:30', DOWN, 'sleep:30', '\r'])
  })

  it('writes a single sequence without sleeping', async () => {
    const log: string[] = []
    await playKeys(['\r'], (s) => log.push(s), 30, (ms) => {
      log.push(`sleep:${ms}`)
      return Promise.resolve()
    })
    expect(log).toEqual(['\r'])
  })

  it('does nothing for an empty list', async () => {
    const writes: string[] = []
    await playKeys([], (s) => writes.push(s), 30, () => Promise.resolve())
    expect(writes).toEqual([])
  })
})
