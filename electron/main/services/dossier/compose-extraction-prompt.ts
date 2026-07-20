// Context-engineering da EXTRAÇÃO de claims de um documento do dossiê: monta o
// prompt PT-BR que vai ao `claude -p` (text-mode) e devolve um único bloco JSON.
// Função PURA (sem I/O) — espelha meeting/compose-extraction-prompt.ts.
//
// As táticas anti-alucinação vivem aqui: documento sempre com `[char:N] texto`,
// exigência de um `verbatim` copiado literalmente, e a instrução de responder SÓ
// com o bloco JSON do schema. O gate de grounding (descarte) é aplicado depois,
// no claude-extractor.

export interface PromptDocSegment {
  anchor: string
  text: string
}

export interface ComposeDossierExtractionArgs {
  url: string
  title?: string
  segments: PromptDocSegment[]
}

// Cada linha é determinística e ancorada: o modelo cita por substring e nós
// validamos o verbatim contra estes mesmos textos.
export function formatDocument(segments: PromptDocSegment[]): string {
  return segments.map((seg) => `[${seg.anchor}] ${seg.text.trim()}`).join('\n')
}

const SCHEMA_BLOCK = `{
  "claims": [
    {
      "claim": "string — afirmação atômica e falsificável, em pt-BR, em uma frase",
      "verbatim": "string — trecho LITERAL do documento que sustenta o claim (copie exatamente, sem parafrasear)",
      "anchor": "string | null — a âncora 'char:N' do segmento de onde o verbatim saiu",
      "importance": "number — 0..1, o quanto o claim é central para o documento"
    }
  ]
}`

export function composeDossierExtractionPrompt(args: ComposeDossierExtractionArgs): string {
  const document = formatDocument(args.segments)
  const sections: string[] = []

  sections.push(
    [
      '## Contexto',
      'Você extrai evidências de um documento web para um dossiê de pesquisa. Cada evidência precisa ser rastreável até um trecho literal do documento — a proveniência é o produto.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Entrada',
      `Documento: ${args.title?.trim() || '(sem título)'}`,
      `URL: ${args.url}`,
      '',
      'Conteúdo (fonte da verdade — formato `[char:N] texto`):',
      document || '(documento vazio)',
    ].join('\n'),
  )

  sections.push(
    [
      '## Tarefa',
      '1. Identifique as afirmações factuais e falsificáveis que o documento sustenta.',
      '2. Para cada uma, escreva um `claim` atômico (uma ideia por claim) em pt-BR.',
      '3. Copie o trecho literal que sustenta o claim em `verbatim` e informe a âncora do segmento.',
      '4. Atribua `importance` (0..1) pela centralidade do claim no documento.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Restrições (grounding — anti-alucinação, OBRIGATÓRIAS)',
      '- [ ] O `verbatim` DEVE ser copiado caractere a caractere do documento acima. Trecho parafraseado ou reescrito é DESCARTADO na validação.',
      '- [ ] Não deduza, não complete e não traga conhecimento externo ao documento.',
      '- [ ] Opinião do autor só vira claim se o claim disser que é opinião dele.',
      '- [ ] `anchor` é a âncora `char:N` do segmento de origem; se não souber, `null`.',
      '- [ ] Se o documento não sustenta nenhuma afirmação, devolva `"claims": []`.',
      '- [ ] Escreva os claims em pt-BR (o `verbatim` fica no idioma original do documento).',
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
