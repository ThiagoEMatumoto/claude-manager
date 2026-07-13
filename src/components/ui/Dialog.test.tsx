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
    // o overlay é a div .fixed portada direto no body (o conteúdo fica aninhado
    // num wrapper de scroll, então não dá pra subir via parentElement do texto)
    const overlay = document.body.querySelector('.fixed')
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
    const overlay = document.body.querySelector('.fixed')!
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape chama onClose', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose}>
        conteúdo
      </Dialog>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('outras teclas não chamam onClose', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose}>
        conteúdo
      </Dialog>,
    )
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape já consumido (defaultPrevented) não chama onClose', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose}>
        conteúdo
      </Dialog>,
    )
    // simula handler interno que consome Escape para outra função
    const consume = (e: KeyboardEvent) => e.preventDefault()
    window.addEventListener('keydown', consume, true)
    fireEvent.keyDown(window, { key: 'Escape' })
    window.removeEventListener('keydown', consume, true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('não escuta keydown quando fechado', () => {
    const onClose = vi.fn()
    render(
      <Dialog open={false} onClose={onClose}>
        conteúdo
      </Dialog>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
