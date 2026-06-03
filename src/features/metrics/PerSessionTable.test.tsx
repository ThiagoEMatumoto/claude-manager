import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PerSessionTable } from './PerSessionTable'
import type { MetricsSessionRow } from '../../../shared/types/ipc'

function makeRows(): MetricsSessionRow[] {
  return [
    {
      ccSessionId: 'aaaaaaaa-1111',
      title: 'Cheap session',
      sessionType: 'quick_chat',
      turns: 3,
      agentCalls: 0,
      costUsd: 0.5,
      lastTs: 1_700_000_000_000,
      projectId: 'p1',
      projectName: 'Alpha',
    },
    {
      ccSessionId: 'bbbbbbbb-2222',
      title: 'Expensive session',
      sessionType: 'agent_orchestration',
      turns: 30,
      agentCalls: 12,
      costUsd: 9.75,
      lastTs: 1_700_500_000_000,
      projectId: 'p2',
      projectName: 'Bravo',
    },
    {
      ccSessionId: 'cccccccc-3333',
      title: 'Mid session',
      sessionType: 'iteration',
      turns: 15,
      agentCalls: 4,
      costUsd: 4.2,
      lastTs: null,
      projectId: null,
      projectName: 'Charlie',
    },
  ]
}

describe('PerSessionTable', () => {
  it('ordena por custo (default desc) e inverte ao clicar no header', () => {
    render(<PerSessionTable rows={makeRows()} />)

    let rows = screen.getAllByTestId('session-row')
    expect(within(rows[0]).getByText('Expensive session')).toBeTruthy()

    fireEvent.click(screen.getByTestId('th-cost'))
    rows = screen.getAllByTestId('session-row')
    expect(within(rows[0]).getByText('Cheap session')).toBeTruthy()
  })

  it('expande e colapsa a linha mostrando o detalhe com "Agent calls"', () => {
    render(<PerSessionTable rows={makeRows()} />)

    expect(screen.queryByTestId('session-detail')).toBeNull()

    const rows = screen.getAllByTestId('session-row')
    fireEvent.click(rows[0])
    const detail = screen.getByTestId('session-detail')
    expect(detail.textContent).toContain('Agent calls')

    fireEvent.click(rows[0])
    expect(screen.queryByTestId('session-detail')).toBeNull()
  })

  it('ordena por turns ao clicar no header de turns', () => {
    render(<PerSessionTable rows={makeRows()} />)

    fireEvent.click(screen.getByTestId('th-turns'))
    const rows = screen.getAllByTestId('session-row')
    expect(within(rows[0]).getByText('Expensive session')).toBeTruthy()
  })

  it('mostra fallback quando a lista está vazia', () => {
    render(<PerSessionTable rows={[]} />)
    expect(screen.getByText('Nenhuma sessão na janela.')).toBeTruthy()
  })
})
