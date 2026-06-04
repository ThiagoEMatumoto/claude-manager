import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UntrackedFolders } from './UntrackedFolders'
import type { UntrackedFolder } from '../../../shared/types/ipc'

const folders: UntrackedFolder[] = [
  { name: 'arara', path: '/vault/pessoal/arara' },
  { name: 'beta', path: '/vault/pessoal/beta' },
]

describe('UntrackedFolders', () => {
  it('não renderiza nada quando a lista está vazia', () => {
    const { container } = render(<UntrackedFolders folders={[]} onAdopt={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lista as pastas não-registradas com a seção e botão Adicionar', () => {
    render(<UntrackedFolders folders={folders} onAdopt={vi.fn()} />)
    expect(screen.getByText('Pastas no vault não adicionadas')).toBeInTheDocument()
    expect(screen.getByText('arara')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Adicionar/ })).toHaveLength(2)
  })

  it('clicar Adicionar chama onAdopt com a pasta correta', () => {
    const onAdopt = vi.fn().mockResolvedValue(undefined)
    render(<UntrackedFolders folders={folders} onAdopt={onAdopt} />)
    fireEvent.click(screen.getByTitle('Adicionar "arara" ao projeto'))
    expect(onAdopt).toHaveBeenCalledWith(folders[0])
  })
})
