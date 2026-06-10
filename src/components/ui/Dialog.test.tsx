import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('não renderiza nada quando open=false', () => {
    render(
      <Dialog open={false} onClose={vi.fn()}>
        conteúdo
      </Dialog>,
    )
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument()
  })

  it('renderiza via portal direto em document.body, acima das camadas do dockview', () => {
    const { container } = render(
      <div data-testid="render-site">
        <Dialog open onClose={vi.fn()} title="Título">
          conteúdo
        </Dialog>
      </div>,
    )
    // getByText retorna o painel interno; o overlay é o pai direto
    const overlay = screen.getByText('conteúdo').parentElement
    expect(overlay).not.toBeNull()
    // portal: o overlay NÃO é descendente do ponto de render, é filho do body
    expect(container.querySelector('.fixed')).toBeNull()
    expect(overlay!.parentElement).toBe(document.body)
    // acima do --dv-overlay-z-index: 999 do dockview
    expect(overlay!.className).toContain('z-[1000]')
  })

  it('clicar no overlay chama onClose; clicar no conteúdo não chama', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Título">
        conteúdo
      </Dialog>,
    )
    fireEvent.mouseDown(screen.getByText('conteúdo'))
    expect(onClose).not.toHaveBeenCalled()
    const overlay = screen.getByText('conteúdo').parentElement!
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
