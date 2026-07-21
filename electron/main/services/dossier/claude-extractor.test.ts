import { describe, expect, it, vi } from 'vitest'
import type { RunResult } from '../claude-cli'
import type { FetchedDocument } from '../dossier-pipeline-types'
import { ClaudeExtractor } from './claude-extractor'

const FIRST = 'The reported outcome improved measurably after the intervention.'
const SECOND = 'Independent analysis confirmed the same directional effect.'

const DOC: FetchedDocument = {
  url: 'https://gov.example/report',
  title: 'Official report',
  text: `${FIRST} ${SECOND}`,
  segments: [
    { anchor: 'char:0', text: FIRST },
    { anchor: `char:${FIRST.length + 1}`, text: SECOND },
  ],
}

function okRun(stdout: string): RunResult {
  return { stdout, stderr: '', code: 0 }
}

describe('ClaudeExtractor', () => {
  it('chama claude -p em text-mode, parseia e mapeia claims com âncora real', async () => {
    const modelJson = {
      claims: [
        { claim: 'O resultado melhorou após a intervenção.', verbatim: FIRST, anchor: 'char:0', importance: 0.9 },
        { claim: 'Uma análise independente confirmou o efeito.', verbatim: SECOND, anchor: 'char:999', importance: 0.4 },
      ],
    }
    const runClaude = vi.fn(async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> =>
      okRun('Welcome to Claude\n```json\n' + JSON.stringify(modelJson) + '\n```'),
    )

    const claims = await new ClaudeExtractor({ runClaude }).extract(DOC, 'src-1')

    expect(runClaude).toHaveBeenCalledOnce()
    expect(runClaude.mock.calls[0]?.[0]).toEqual([
      '-p',
      expect.any(String),
      '--output-format',
      'text',
    ])
    expect(claims).toEqual([
      {
        claim: 'O resultado melhorou após a intervenção.',
        verbatimQuote: FIRST,
        anchor: 'char:0',
        importance: 0.9,
      },
      {
        claim: 'Uma análise independente confirmou o efeito.',
        verbatimQuote: SECOND,
        // âncora recalculada do offset REAL, ignorando o char:999 do modelo
        anchor: `char:${FIRST.length + 1}`,
        importance: 0.4,
      },
    ])
  })

  it('descarta claim cujo verbatim não está no documento (gate anti-alucinação)', async () => {
    const modelJson = {
      claims: [
        { claim: 'Real', verbatim: FIRST, anchor: 'char:0', importance: 0.8 },
        { claim: 'Inventado', verbatim: 'The study proved causation beyond doubt.', anchor: 'char:0', importance: 0.9 },
      ],
    }
    const runClaude = vi.fn(async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> => okRun(JSON.stringify(modelJson)))

    const claims = await new ClaudeExtractor({ runClaude }).extract(DOC, 'src-1')

    expect(claims).toHaveLength(1)
    expect(claims[0].claim).toBe('Real')
  })

  it('faz retry 1x com bloco "## Correção" quando o JSON vem malformado', async () => {
    const good = { claims: [{ claim: 'Real', verbatim: FIRST, anchor: 'char:0', importance: 0.5 }] }
    const runClaude = vi
      .fn<(args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>>()
      .mockResolvedValueOnce(okRun('não sou JSON'))
      .mockResolvedValueOnce(okRun(JSON.stringify(good)))

    const claims = await new ClaudeExtractor({ runClaude }).extract(DOC, 'src-1')

    expect(runClaude).toHaveBeenCalledTimes(2)
    const retryPrompt = runClaude.mock.calls[1]?.[0]?.[1] ?? ''
    expect(retryPrompt).toContain('## Correção')
    expect(retryPrompt).toContain('nenhum bloco JSON encontrado')
    expect(claims).toHaveLength(1)
  })

  it('propaga erro quando o claude sai com código != 0', async () => {
    const runClaude = vi.fn(async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> => ({
      stdout: '',
      stderr: 'boom',
      code: 1,
    }))

    await expect(new ClaudeExtractor({ runClaude }).extract(DOC, 'src-1')).rejects.toThrow(
      /claude -p falhou \(exit 1\)/,
    )
  })
})
