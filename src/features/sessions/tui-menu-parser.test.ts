import { describe, expect, it } from 'vitest'
import { menuFingerprint, parseTuiMenu } from './tui-menu-parser'

// Fixtures espelham o desenho REAL da TUI do claude 2.1.212 (validação live +
// strings do binário) — ver header do tui-menu-parser.

// Menu de AskUserQuestion como visto ao vivo: chip, pergunta, 3 opções com
// descrição indentada + sentinelas Type something./Chat about this, rodapé.
const FRUIT_MENU = `● I'll ask you about your fruit preference.

 Fruta

Qual fruta você prefere?

❯ 1. Maçã
     Maçã
  2. Banana
     Banana
  3. Uva
     Uva
  4. Type something.

  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`

describe('parseTuiMenu — menu de pergunta', () => {
  it('parseia o menu normal com sentinelas', () => {
    const menu = parseTuiMenu(FRUIT_MENU)
    expect(menu).not.toBeNull()
    expect(menu!.kind).toBe('question')
    expect(menu!.question).toBe('Qual fruta você prefere?')
    expect(menu!.multiSelect).toBe(false)
    expect(menu!.options).toHaveLength(5)
    expect(menu!.options[0]).toMatchObject({ index: 0, label: 'Maçã', description: 'Maçã' })
    expect(menu!.options[1]).toMatchObject({ index: 1, label: 'Banana' })
    expect(menu!.options[2]).toMatchObject({ index: 2, label: 'Uva' })
    expect(menu!.options[3]).toMatchObject({ index: 3, sentinel: 'other' })
    expect(menu!.options[4]).toMatchObject({ index: 4, sentinel: 'chat' })
  })

  it('junta wrap de pane estreita na descrição da opção anterior', () => {
    const menu = parseTuiMenu(`Qual abordagem?

❯ 1. As duas linhas
     Corrige clone e cd — o bloco fica
     consistente, mas são 2 linhas.
  2. Só a linha 11
     Estritamente uma linha.
  3. Type something.

Enter to select · ↑/↓ to navigate · Esc to cancel
`)
    expect(menu).not.toBeNull()
    expect(menu!.options[0].description).toBe(
      'Corrige clone e cd — o bloco fica consistente, mas são 2 linhas.',
    )
    expect(menu!.options[1].description).toBe('Estritamente uma linha.')
  })

  it('tolera rodapé e linha de status de modo depois da última opção', () => {
    const menu = parseTuiMenu(`Pergunta?

❯ 1. Sim
  2. Não

Enter to select · ↑/↓ to navigate · Esc to cancel
⏵⏵ bypass permissions on (shift+tab to cycle)
`)
    expect(menu).not.toBeNull()
    expect(menu!.options).toHaveLength(2)
  })

  it('marca multiSelect quando o rodapé é de checkbox (Space to toggle)', () => {
    const menu = parseTuiMenu(`Quais itens?

❯ 1. Item A
  2. Item B
  3. Item C

Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest
`)
    expect(menu).not.toBeNull()
    expect(menu!.multiSelect).toBe(true)
  })
})

describe('parseTuiMenu — menu de plano', () => {
  it('classifica o menu de 3 opções pela pergunta e pelos labels', () => {
    const menu = parseTuiMenu(`Claude has written up a plan and is ready to execute. Would you like to proceed?

❯ 1. Yes, auto-accept edits
  2. Yes, manually approve edits
  3. No, keep planning

Enter to select · ↑/↓ to navigate · Esc to cancel
`)
    expect(menu).not.toBeNull()
    expect(menu!.kind).toBe('plan')
    expect(menu!.options).toHaveLength(3)
    expect(menu!.options[1].label).toBe('Yes, manually approve edits')
  })

  it('classifica variantes com mais opções (contagem varia entre versões)', () => {
    const menu = parseTuiMenu(`Exit plan mode?

❯ 1. Yes, and bypass permissions
  2. Yes, auto-accept edits
  3. Yes, manually approve edits
  4. Yes, manually approve edits and stay in ultraplan
  5. No, keep planning

Enter to select · ↑/↓ to navigate · Esc to cancel
`)
    expect(menu).not.toBeNull()
    expect(menu!.kind).toBe('plan')
    expect(menu!.options).toHaveLength(5)
  })
})

describe('parseTuiMenu — fail-closed', () => {
  it('rejeita menu scrollado (numeração não começa em 1)', () => {
    expect(
      parseTuiMenu(`  2. Banana
  3. Uva
  4. Type something.

Enter to select · ↑/↓ to navigate · Esc to cancel
`),
    ).toBeNull()
  })

  it('rejeita numeração não-contígua', () => {
    expect(
      parseTuiMenu(`Pergunta?

❯ 1. A
  3. B

Enter to select · ↑/↓ to navigate · Esc to cancel
`),
    ).toBeNull()
  })

  it('rejeita multi-pergunta (tela Review your answers)', () => {
    expect(
      parseTuiMenu(`Fruta  Cor  Review your answers

Qual fruta?

❯ 1. Maçã
  2. Banana

Enter to select · ↑/↓ to navigate · Esc to cancel
`),
    ).toBeNull()
  })

  it('rejeita prompt de permissão (Do you want / don’t ask again) — Fase 4', () => {
    expect(
      parseTuiMenu(`Do you want to proceed?

❯ 1. Yes
  2. Yes, and don't ask again for this command
  3. No, and tell Claude what to do differently (esc)

Enter to select · ↑/↓ to navigate · Esc to cancel
`),
    ).toBeNull()
  })

  it('rejeita lista numerada de markdown que não termina perto do fim', () => {
    expect(
      parseTuiMenu(`Plano:

1. Primeiro passo
2. Segundo passo
3. Terceiro passo

Esse é o racional da abordagem, em prosa longa
que segue depois da lista.
`),
    ).toBeNull()
  })

  it('rejeita texto sem linhas numeradas ou vazio', () => {
    expect(parseTuiMenu('')).toBeNull()
    expect(parseTuiMenu('só prosa\nsem menu\n')).toBeNull()
  })

  it('rejeita run de uma opção só', () => {
    expect(parseTuiMenu('Pergunta?\n\n❯ 1. Única\n')).toBeNull()
  })
})

describe('menuFingerprint', () => {
  it('é estável pro mesmo menu e distingue menus diferentes', () => {
    const a = parseTuiMenu(FRUIT_MENU)!
    const b = parseTuiMenu(FRUIT_MENU)!
    expect(menuFingerprint(a)).toBe(menuFingerprint(b))
    const other = parseTuiMenu(FRUIT_MENU.replace('Qual fruta você prefere?', 'Outra pergunta?'))!
    expect(menuFingerprint(other)).not.toBe(menuFingerprint(a))
  })

  it('distingue pergunta de plano e single de multi', () => {
    const q = parseTuiMenu(FRUIT_MENU)!
    expect(menuFingerprint(q)).toContain('question')
    expect(menuFingerprint(q)).toContain('single')
  })
})
