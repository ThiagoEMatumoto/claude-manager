import type { VerifyCandidate } from '../dossier-pipeline-types'

// Context-engineering da VERIFICAÇÃO cruzada do dossiê: monta o prompt PT-BR que
// vai ao `claude -p` (text-mode) e devolve um único bloco JSON. Função PURA.
//
// O modelo NÃO decide o estado da evidência — isso é roteamento por confiança da
// fonte (regra de produto, em routeEvidenceState). Aqui ele só responde à
// pergunta semântica: quais claims dizem a mesma coisa e quais se contradizem.
//
// Os ids reais (uuid) não entram no prompt: cada candidato recebe um rótulo curto
// (C1..Cn) e a fonte um rótulo (S1..Sk), traduzidos de volta no claude-verifier.

export interface LabeledCandidate {
  label: string
  sourceLabel: string
  candidate: VerifyCandidate
}

export function labelCandidates(candidates: readonly VerifyCandidate[]): LabeledCandidate[] {
  const sourceLabels = new Map<string, string>()
  return candidates.map((candidate, i) => {
    let sourceLabel = sourceLabels.get(candidate.sourceId)
    if (!sourceLabel) {
      sourceLabel = `S${sourceLabels.size + 1}`
      sourceLabels.set(candidate.sourceId, sourceLabel)
    }
    return { label: `C${i + 1}`, sourceLabel, candidate }
  })
}

function formatCandidate(item: LabeledCandidate): string {
  return [
    `- ${item.label} [fonte: ${item.sourceLabel}] [confiança da fonte: ${item.candidate.trustTier}]`,
    `  claim: ${item.candidate.claim}`,
    `  verbatim: "${item.candidate.verbatimQuote}"`,
  ].join('\n')
}

const SCHEMA_BLOCK = `{
  "relations": [
    {
      "claim_id": "C1",
      "corroborated_by": ["C2"],
      "contradicted_by": ["C3"]
    }
  ]
}`

export function composeDossierVerificationPrompt(items: LabeledCandidate[]): string {
  const sections: string[] = []

  sections.push(
    [
      '## Contexto',
      'Você faz a verificação cruzada das evidências de um dossiê de pesquisa. Cada claim abaixo foi extraído de uma fonte com proveniência verbatim. Duas fontes independentes que afirmam a mesma coisa aumentam a confiança; duas que afirmam o oposto abrem uma disputa.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Entrada',
      'Claims candidatos:',
      items.length > 0 ? items.map(formatCandidate).join('\n') : '(nenhum claim)',
    ].join('\n'),
  )

  sections.push(
    [
      '## Tarefa',
      'Para CADA claim da lista, informe:',
      '1. `corroborated_by` — os claims de OUTRAS fontes que afirmam substancialmente a mesma coisa.',
      '2. `contradicted_by` — os claims de OUTRAS fontes que afirmam o oposto ou são incompatíveis com ele.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Restrições (OBRIGATÓRIAS)',
      '- [ ] Claims da MESMA fonte nunca se corroboram nem se contradizem — ignore esses pares.',
      '- [ ] Um claim nunca se relaciona consigo mesmo.',
      '- [ ] Use SOMENTE os rótulos que aparecem na entrada (C1, C2, …). Não invente rótulos.',
      '- [ ] Falar do mesmo tema NÃO é corroborar: só corrobora quem afirma a mesma coisa. Na dúvida, deixe o array vazio.',
      '- [ ] Contradição é incompatibilidade factual (números opostos, negação direta), não diferença de ênfase.',
      '- [ ] Não julgue a qualidade da fonte — a confiança já é tratada fora daqui.',
      '- [ ] Inclua uma entrada para cada claim, mesmo que os dois arrays fiquem vazios.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Formato da resposta',
      'Responda APENAS com um único bloco JSON válido, exatamente neste schema (sem texto antes ou depois, sem comentários):',
      '```json',
      SCHEMA_BLOCK,
      '```',
    ].join('\n'),
  )

  return sections.join('\n\n')
}
