import type { SynthRecord } from '../dossier-pipeline-types'

// Context-engineering da SÍNTESE graduada do dossiê: monta o prompt PT-BR que vai
// ao `claude -p` (text-mode) e devolve um único bloco JSON. Função PURA (sem I/O).
//
// A graduação (as 5 seções) é regra de produto e NÃO é decidida pelo modelo: cada
// evidência já chega rotulada com a seção a que pertence. O modelo escreve a prosa
// e é obrigado a citar `evidence_id` em cada afirmação — o que permite validar a
// citação depois do parse.

export type SynthSection =
  | 'confirmed'
  | 'contested'
  | 'singleSource'
  | 'marketSignal'
  | 'gaps'

export const SECTION_TITLES: Record<SynthSection, string> = {
  confirmed: '✅ Confirmado',
  contested: '⚖️ Contestado',
  singleSource: '• Fonte-única',
  marketSignal: '📣 Sinal de mercado',
  gaps: '🕳️ Lacunas',
}

export const SECTION_ORDER: SynthSection[] = [
  'confirmed',
  'contested',
  'singleSource',
  'marketSignal',
  'gaps',
]

// Decide a seção de um record. vendor_marketing sempre cai em "Sinal de mercado"
// (independe do state); o resto segue o state de verificação.
export function sectionForRecord(record: SynthRecord): SynthSection {
  if (record.sourceClass === 'vendor_marketing') return 'marketSignal'
  switch (record.state) {
    case 'primary_accepted':
    case 'corroborated':
      return 'confirmed'
    case 'contested':
      return 'contested'
    case 'single_source':
      return 'singleSource'
    default:
      return 'gaps'
  }
}

// Evidência roteada para a sua seção. O id citado é o do EvidenceRecord — é ele
// que amarra a afirmação da síntese à proveniência guardada no banco.
export interface IdentifiedRecord {
  id: string
  section: SynthSection
  record: SynthRecord
}

export function identifyRecords(records: readonly SynthRecord[]): IdentifiedRecord[] {
  return records.map((record) => ({
    id: record.id,
    section: sectionForRecord(record),
    record,
  }))
}

function formatRecord(item: IdentifiedRecord): string {
  const { record } = item
  return [
    `- ${item.id} [seção: ${SECTION_TITLES[item.section]}] [classe: ${record.sourceClass}] [estado: ${record.state}]`,
    `  claim: ${record.claim}`,
    `  verbatim: "${record.verbatimQuote}"`,
  ].join('\n')
}

const SCHEMA_BLOCK = `{
  "sections": {
    "confirmed":    [{ "text": "string — afirmação em pt-BR", "evidence_ids": ["<id da entrada>"] }],
    "contested":    [{ "text": "string", "evidence_ids": ["<id>", "<id>"] }],
    "singleSource": [{ "text": "string", "evidence_ids": ["<id>"] }],
    "marketSignal": [{ "text": "string", "evidence_ids": ["<id>"] }],
    "gaps":         [{ "text": "string — o que ficou sem resposta", "evidence_ids": [] }]
  }
}`

export interface ComposeSynthesisArgs {
  question?: string
  items: IdentifiedRecord[]
}

export function composeDossierSynthesisPrompt(args: ComposeSynthesisArgs): string {
  const sections: string[] = []
  const evidenceBlock =
    args.items.length > 0
      ? args.items.map(formatRecord).join('\n')
      : '(nenhuma evidência sobreviveu à verificação)'

  sections.push(
    [
      '## Contexto',
      'Você escreve a síntese graduada de um dossiê de pesquisa. A graduação já está decidida: cada evidência abaixo chega com a seção a que pertence. Seu trabalho é a prosa — agrupar o que se repete e nomear o que a evidência efetivamente sustenta.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Entrada',
      args.question?.trim() ? `Pergunta do dossiê: ${args.question.trim()}` : '(pergunta não informada)',
      '',
      'Evidências verificadas:',
      evidenceBlock,
    ].join('\n'),
  )

  sections.push(
    [
      '## Tarefa',
      '1. Escreva as afirmações de cada seção a partir das evidências roteadas para ela.',
      '2. Agrupe evidências que dizem a mesma coisa numa única afirmação, citando todos os ids.',
      '3. Em `gaps`, aponte o que a pergunta pede e a evidência coletada NÃO responde.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Restrições (OBRIGATÓRIAS)',
      '- [ ] Cada afirmação DEVE citar em `evidence_ids` ao menos um id da lista acima. Afirmação sem citação válida é DESCARTADA na validação.',
      '- [ ] Use SOMENTE ids que aparecem na entrada. Não invente ids.',
      '- [ ] Não misture evidências de seções diferentes numa mesma afirmação.',
      '- [ ] Não traga conhecimento externo: a síntese é do que as evidências dizem.',
      '- [ ] `gaps` é a única seção que pode ter `evidence_ids` vazio.',
      '- [ ] Seção sem evidência fica com array vazio. Responda em pt-BR.',
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
