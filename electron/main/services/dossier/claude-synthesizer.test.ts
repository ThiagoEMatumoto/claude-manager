import { describe, expect, it, vi } from 'vitest'
import type { RunResult } from '../claude-cli'
import type { SynthRecord } from '../dossier-pipeline-types'
import { ClaudeSynthesizer } from './claude-synthesizer'

const RECORDS: SynthRecord[] = [
  {
    claim: 'O programa reduziu o abandono.',
    verbatimQuote: 'the dropout rate fell by 12%',
    state: 'primary_accepted',
    sourceClass: 'primary_official',
  },
  {
    claim: 'O efeito não se sustenta no longo prazo.',
    verbatimQuote: 'the effect faded after 18 months',
    state: 'contested',
    sourceClass: 'academic',
  },
  {
    claim: 'A solução do fornecedor resolve o problema.',
    verbatimQuote: 'our platform eliminates dropout',
    state: 'single_source',
    sourceClass: 'vendor_marketing',
  },
]

function okRun(stdout: string): RunResult {
  return { stdout, stderr: '', code: 0 }
}

describe('ClaudeSynthesizer', () => {
  it('chama claude -p em text-mode e renderiza as 5 seções com as citações', async () => {
    const modelJson = {
      sections: {
        confirmed: [{ text: 'O programa reduziu o abandono.', evidence_ids: ['E1'] }],
        contested: [{ text: 'O efeito de longo prazo é disputado.', evidence_ids: ['E2'] }],
        singleSource: [],
        marketSignal: [{ text: 'O fornecedor promete eliminar o abandono.', evidence_ids: ['E3'] }],
        gaps: [{ text: 'Nenhuma evidência sobre custo por beneficiário.', evidence_ids: [] }],
      },
    }
    const runClaude = vi.fn(async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> =>
      okRun('```json\n' + JSON.stringify(modelJson) + '\n```'),
    )

    const summary = await new ClaudeSynthesizer({ runClaude, question: 'O programa funciona?' }).synthesize(
      RECORDS,
    )

    expect(runClaude).toHaveBeenCalledOnce()
    expect(runClaude.mock.calls[0]?.[0]).toEqual([
      '-p',
      expect.any(String),
      '--output-format',
      'text',
    ])

    expect(summary).toContain('## ✅ Confirmado\n- O programa reduziu o abandono. [E1]')
    expect(summary).toContain('## ⚖️ Contestado\n- O efeito de longo prazo é disputado. [E2]')
    expect(summary).toContain('## • Fonte-única\n_nenhum_')
    expect(summary).toContain('## 📣 Sinal de mercado')
    expect(summary).toContain('## 🕳️ Lacunas\n- Nenhuma evidência sobre custo por beneficiário.')

    // o vendor_marketing é roteado (regra de produto) e citado no prompt
    const prompt = runClaude.mock.calls[0]?.[0]?.[1] ?? ''
    expect(prompt).toContain('E3 [seção: 📣 Sinal de mercado]')
    expect(prompt).toContain('O programa funciona?')
  })

  it('descarta afirmação que cita evidence_id inexistente', async () => {
    const modelJson = {
      sections: {
        confirmed: [
          { text: 'Válida', evidence_ids: ['E1', 'E99'] },
          { text: 'Fabricada', evidence_ids: ['E42'] },
        ],
        contested: [],
        singleSource: [],
        marketSignal: [],
        gaps: [],
      },
    }
    const runClaude = vi.fn(async (_args: string[], _opts?: { timeoutMs?: number }): Promise<RunResult> => okRun(JSON.stringify(modelJson)))

    const summary = await new ClaudeSynthesizer({ runClaude }).synthesize(RECORDS)

    expect(summary).toContain('- Válida [E1]')
    expect(summary).not.toContain('E99')
    expect(summary).not.toContain('Fabricada')
  })

  it('faz retry 1x com bloco "## Correção" quando o schema não bate', async () => {
    const good = {
      sections: { confirmed: [{ text: 'ok', evidence_ids: ['E1'] }], contested: [], singleSource: [], marketSignal: [], gaps: [] },
    }
    const runClaude = vi
      .fn<(args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>>()
      .mockResolvedValueOnce(okRun('{"sections": "não é objeto"}'))
      .mockResolvedValueOnce(okRun(JSON.stringify(good)))

    const summary = await new ClaudeSynthesizer({ runClaude }).synthesize(RECORDS)

    expect(runClaude).toHaveBeenCalledTimes(2)
    const retryPrompt = runClaude.mock.calls[1]?.[0]?.[1] ?? ''
    expect(retryPrompt).toContain('## Correção')
    expect(retryPrompt).toContain('schema inválido')
    expect(summary).toContain('- ok [E1]')
  })
})
