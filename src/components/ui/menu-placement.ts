/**
 * Posicionamento puro do painel do Menu portalizado (position:fixed).
 *
 * Decide se o painel abre PARA BAIXO (ancorado ao fundo do trigger) ou PARA CIMA
 * (ancorado ao topo do trigger), e calcula um max-height que nunca deixa o painel
 * exceder a viewport. Isso evita o clipping quando o trigger fica no rodapé da
 * janela (caso dos pills do composer) e o menu transbordaria a borda inferior.
 *
 * Sem dependência de DOM/React: recebe medidas e devolve estilos → testável.
 */

export type MenuPlacementSide = 'below' | 'above'

export interface MenuPlacement {
  /** left absoluto em px (já resolve `align` e clampa na viewport). */
  left: number
  /** Setado quando abre para baixo. */
  top?: number
  /** Setado quando abre para cima (distância da borda inferior da viewport). */
  bottom?: number
  /** Teto de altura em px → o painel rola (overflow-y) se o conteúdo passar disto. */
  maxHeight: number
  side: MenuPlacementSide
}

export interface MenuPlacementArgs {
  /** getBoundingClientRect() do trigger. */
  rect: { top: number; bottom: number; left: number; right: number }
  /** Altura natural do conteúdo do painel (scrollHeight). */
  menuH: number
  /** Largura do painel (offsetWidth). */
  menuW: number
  viewportW: number
  viewportH: number
  /** 'right' (default): borda direita do painel alinha à direita do trigger. */
  align: 'left' | 'right'
  /** Folga entre painel e trigger. */
  gap?: number
  /** Margem mínima até a borda da viewport. */
  margin?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function computeMenuPlacement({
  rect,
  menuH,
  menuW,
  viewportW,
  viewportH,
  align,
  gap = 4,
  margin = 8,
}: MenuPlacementArgs): MenuPlacement {
  const availBelow = Math.max(0, viewportH - rect.bottom - gap - margin)
  const availAbove = Math.max(0, rect.top - gap - margin)

  // Preferir abaixo (comportamento histórico). Só vira pra cima se não couber
  // abaixo. Se não couber em nenhum lado, escolhe o lado com mais espaço.
  let side: MenuPlacementSide
  if (menuH <= availBelow) side = 'below'
  else if (menuH <= availAbove) side = 'above'
  else side = availBelow >= availAbove ? 'below' : 'above'

  const sideSpace = side === 'below' ? availBelow : availAbove
  const maxHeight = sideSpace

  // Horizontal: resolve align e clampa para não sair da viewport.
  const rawLeft = align === 'left' ? rect.left : rect.right - menuW
  const left = clamp(rawLeft, margin, viewportW - menuW - margin)

  return side === 'below'
    ? { side, left, top: rect.bottom + gap, maxHeight }
    : { side, left, bottom: viewportH - rect.top + gap, maxHeight }
}
