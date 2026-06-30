import { describe, expect, it } from 'vitest'
import { computeMenuPlacement } from './menu-placement'

const viewportW = 1280
const viewportH = 800

// trigger genérico no canto inferior-direito (caso dos pills do composer)
const bottomRightTrigger = { top: 760, bottom: 784, left: 1140, right: 1200 }
// trigger no topo (caso de menus no header / architecture canvas)
const topTrigger = { top: 40, bottom: 64, left: 100, right: 200 }

describe('computeMenuPlacement', () => {
  it('abre para baixo quando há espaço abaixo', () => {
    const p = computeMenuPlacement({
      rect: topTrigger,
      menuH: 200,
      menuW: 160,
      viewportW,
      viewportH,
      align: 'left',
    })
    expect(p.side).toBe('below')
    expect(p.top).toBe(topTrigger.bottom + 4)
    expect(p.bottom).toBeUndefined()
    expect(p.maxHeight).toBeGreaterThanOrEqual(200)
  })

  it('abre para cima quando o trigger está colado no rodapé', () => {
    const p = computeMenuPlacement({
      rect: bottomRightTrigger,
      menuH: 200,
      menuW: 160,
      viewportW,
      viewportH,
      align: 'right',
    })
    expect(p.side).toBe('above')
    expect(p.bottom).toBe(viewportH - bottomRightTrigger.top + 4)
    expect(p.top).toBeUndefined()
    // cabe acima → maxHeight comporta o conteúdo
    expect(p.maxHeight).toBeGreaterThanOrEqual(200)
  })

  it('cap de altura + scroll quando não cabe em nenhum dos lados (escolhe o maior)', () => {
    // trigger no terço superior: bem mais espaço abaixo que acima; menu de 1000px não cabe.
    const mid = { top: 300, bottom: 312, left: 600, right: 700 }
    const p = computeMenuPlacement({
      rect: mid,
      menuH: 1000,
      menuW: 160,
      viewportW,
      viewportH,
      align: 'left',
    })
    expect(p.maxHeight).toBeLessThan(1000)
    expect(p.maxHeight).toBeLessThanOrEqual(viewportH)
    // espaço abaixo (800-412) > acima (400) → abre embaixo
    expect(p.side).toBe('below')
    expect(p.top).toBe(mid.bottom + 4)
  })

  it('escolhe o lado de cima quando ele tem mais espaço e o menu não cabe', () => {
    // trigger bem no fundo: pouco espaço abaixo, muito acima.
    const lowTrigger = { top: 700, bottom: 720, left: 600, right: 700 }
    const p = computeMenuPlacement({
      rect: lowTrigger,
      menuH: 1000,
      menuW: 160,
      viewportW,
      viewportH,
      align: 'left',
    })
    expect(p.side).toBe('above')
    expect(p.bottom).toBe(viewportH - lowTrigger.top + 4)
    expect(p.maxHeight).toBeLessThan(1000)
  })

  it('alinha pela borda direita do trigger quando align=right', () => {
    const p = computeMenuPlacement({
      rect: topTrigger,
      menuH: 100,
      menuW: 160,
      viewportW,
      viewportH,
      align: 'right',
    })
    // borda direita do painel encosta na direita do trigger
    expect(p.left + 160).toBe(topTrigger.right)
  })

  it('alinha pela borda esquerda do trigger quando align=left', () => {
    const p = computeMenuPlacement({
      rect: topTrigger,
      menuH: 100,
      menuW: 160,
      viewportW,
      viewportH,
      align: 'left',
    })
    expect(p.left).toBe(topTrigger.left)
  })

  it('clampa horizontalmente para não vazar a borda direita da viewport', () => {
    // trigger colado na direita, align=left empurraria o painel pra fora
    const rightEdge = { top: 40, bottom: 64, left: 1240, right: 1278 }
    const p = computeMenuPlacement({
      rect: rightEdge,
      menuH: 100,
      menuW: 200,
      viewportW,
      viewportH,
      align: 'left',
    })
    expect(p.left).toBeLessThanOrEqual(viewportW - 200 - 8)
    expect(p.left).toBeGreaterThanOrEqual(8)
  })
})
