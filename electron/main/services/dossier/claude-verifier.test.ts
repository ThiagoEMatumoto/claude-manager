import { describe, expect, it, vi } from 'vitest'
import type { RunResult } from '../claude-cli'
import type { VerifyCandidate } from '../dossier-pipeline-types'
import { ClaudeVerifier } from './claude-verifier'

// Duas fontes distintas falando do mesmo número + uma terceira afirmando o oposto.
const CANDIDATES: VerifyCandidate[] = [
  {
    id: 'ev-gov',
    claim: 'O abandono caiu 12% após o programa.',
    verbatimQuote: 'the dropout rate fell by 12%',
    sourceId: 'src-gov',
    trustTier: 'medium',
  },
  {
    id: 'ev-press',
    claim: 'A queda do abandono foi de 12%.',
    verbatimQuote: 'a drop of 12 percent in dropouts',
    sourceId: 'src-press',
    trustTier: 'medium',
  },
  {
    id: 'ev-forum',
    claim: 'O abandono não caiu após o programa.',
    verbatimQuote: 'nothing changed for us',
    sourceId: 'src-forum',
    trustTier: 'low',
  },
]

function okRun(stdout: string): RunResult {
  return { stdout, stderr: '', code: 0 }
}

describe('ClaudeVerifier', () => {
  it('corroboração entre fontes distintas → corroborated com corroboratedBy', async () => {
    const modelJson = {
      relations: [
        { claim_id: 'C1', corroborated_by: ['C2'], contradicted_by: [] },
        { claim_id: 'C2', corroborated_by: ['C1'], contradicted_by: [] },
        { claim_id: 'C3', corroborated_by: [], contradicted_by: [] },
      ],
    }
    const runClaude = vi.fn(
      async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> =>
        okRun('```json\n' + JSON.stringify(modelJson) + '\n```'),
    )

    const verdicts = await new ClaudeVerifier({ runClaude }).verify(CANDIDATES)

    expect(runClaude).toHaveBeenCalledOnce()
    expect(runClaude.mock.calls[0]?.[0]).toEqual([
      '-p',
      expect.any(String),
      '--output-format',
      'text',
    ])
    // o uuid real não vai ao modelo — vai o rótulo curto
    const prompt = runClaude.mock.calls[0]?.[0]?.[1] ?? ''
    expect(prompt).toContain('C1 [fonte: S1]')
    expect(prompt).not.toContain('ev-gov')

    expect(verdicts.get('ev-gov')).toEqual({
      state: 'corroborated',
      corroboratedBy: ['ev-press'],
      contradictedBy: [],
    })
    expect(verdicts.get('ev-forum')).toEqual({
      state: 'single_source',
      corroboratedBy: [],
      contradictedBy: [],
    })
  })

  it('contradição entre duas fontes → contested com contradictedBy (relação simétrica)', async () => {
    // O modelo cita a contradição só de um lado; o outro herda por simetria.
    const modelJson = {
      relations: [
        { claim_id: 'C1', corroborated_by: ['C2'], contradicted_by: ['C3'] },
        { claim_id: 'C2', corroborated_by: ['C1'], contradicted_by: [] },
        { claim_id: 'C3', corroborated_by: [], contradicted_by: [] },
      ],
    }
    const runClaude = vi.fn(
      async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> =>
        okRun(JSON.stringify(modelJson)),
    )

    const verdicts = await new ClaudeVerifier({ runClaude }).verify(CANDIDATES)

    expect(verdicts.get('ev-gov')).toEqual({
      state: 'contested',
      corroboratedBy: ['ev-press'],
      contradictedBy: ['ev-forum'],
    })
    expect(verdicts.get('ev-forum')).toEqual({
      state: 'contested',
      corroboratedBy: [],
      contradictedBy: ['ev-gov'],
    })
  })

  it('descarta rótulo inexistente, auto-referência e par da mesma fonte', async () => {
    const sameSource: VerifyCandidate[] = [
      { ...CANDIDATES[0], id: 'ev-a', sourceId: 'src-gov' },
      { ...CANDIDATES[1], id: 'ev-b', sourceId: 'src-gov' },
    ]
    const modelJson = {
      relations: [
        { claim_id: 'C1', corroborated_by: ['C2', 'C1', 'C99'], contradicted_by: [] },
        { claim_id: 'C2', corroborated_by: ['C1'], contradicted_by: [] },
      ],
    }
    const runClaude = vi.fn(
      async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> =>
        okRun(JSON.stringify(modelJson)),
    )

    const verdicts = await new ClaudeVerifier({ runClaude }).verify(sameSource)

    expect(verdicts.get('ev-a')).toEqual({
      state: 'single_source',
      corroboratedBy: [],
      contradictedBy: [],
    })
  })

  it('fonte high sem relações → primary_accepted', async () => {
    const modelJson = { relations: [{ claim_id: 'C1', corroborated_by: [], contradicted_by: [] }] }
    const runClaude = vi.fn(
      async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> =>
        okRun(JSON.stringify(modelJson)),
    )

    const verdicts = await new ClaudeVerifier({ runClaude }).verify([
      { ...CANDIDATES[0], trustTier: 'high' },
    ])

    expect(verdicts.get('ev-gov')?.state).toBe('primary_accepted')
  })

  it('faz retry 1x com bloco "## Correção" quando o JSON vem malformado', async () => {
    const good = { relations: [{ claim_id: 'C1', corroborated_by: [], contradicted_by: [] }] }
    const runClaude = vi
      .fn<(args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>>()
      .mockResolvedValueOnce(okRun('desculpe, não consigo'))
      .mockResolvedValueOnce(okRun(JSON.stringify(good)))

    const verdicts = await new ClaudeVerifier({ runClaude }).verify([CANDIDATES[0]])

    expect(runClaude).toHaveBeenCalledTimes(2)
    const retryPrompt = runClaude.mock.calls[1]?.[0]?.[1] ?? ''
    expect(retryPrompt).toContain('## Correção')
    expect(retryPrompt).toContain('nenhum bloco JSON encontrado')
    expect(verdicts.get('ev-gov')?.state).toBe('single_source')
  })

  it('não chama o claude com lote vazio', async () => {
    const runClaude = vi.fn(
      async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> => okRun('{}'),
    )
    const verdicts = await new ClaudeVerifier({ runClaude }).verify([])
    expect(runClaude).not.toHaveBeenCalled()
    expect(verdicts.size).toBe(0)
  })
})
