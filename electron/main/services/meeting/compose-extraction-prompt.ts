// Context-engineering da EXTRAÇÃO de reunião: monta o prompt PT-BR que vai ao
// `claude -p` (text-mode) e devolve um único bloco JSON. Função PURA (sem I/O)
// para ser trivialmente testável — espelha handoff/compose-prompt.ts.
//
// As táticas anti-alucinação ("groundingTactics") vivem aqui: transcript sempre
// com `[SPEAKER @mm:ss] texto`, exigência de uma quote literal por item, "null
// quando não dito", e a instrução de responder SÓ com o bloco JSON do schema.

export interface PromptSegment {
  speakerLabel: string | null
  startMs: number | null
  text: string
}

export interface PromptLinkable {
  id: string
  title: string
}

export interface ComposeExtractionArgs {
  rawNotes: string | null
  segments: PromptSegment[]
  // Objetivos/features ativos: injetados só como referência para o modelo
  // SUGERIR vínculos (o vínculo final é humano, na UI). Opcionais.
  objectives?: PromptLinkable[]
  features?: PromptLinkable[]
}

function formatTimestamp(startMs: number | null): string {
  if (startMs == null || !Number.isFinite(startMs) || startMs < 0) return '--:--'
  const totalSeconds = Math.floor(startMs / 1000)
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// Cada linha do transcript é determinística e ancorada: o modelo cita por
// substring e nós validamos a quote contra estes mesmos textos.
export function formatTranscript(segments: PromptSegment[]): string {
  return segments
    .map((seg) => {
      const speaker = seg.speakerLabel?.trim() || 'SPEAKER_??'
      return `[${speaker} @${formatTimestamp(seg.startMs)}] ${seg.text.trim()}`
    })
    .join('\n')
}

function formatLinkables(label: string, items: PromptLinkable[]): string {
  const lines = items.map((it) => `- ${it.title} (id: ${it.id})`)
  return [`### ${label} ativos (para sugerir vínculo)`, ...lines].join('\n')
}

const SCHEMA_BLOCK = `{
  "summary": "string — resumo objetivo da reunião em pt-BR, baseado SÓ no transcript",
  "augmented_notes": "string — as notas do usuário reescritas/organizadas e enriquecidas com o transcript, em Markdown pt-BR. NÃO inventar fatos.",
  "items": [
    {
      "type": "action_item | decision | feedback | risk | question",
      "text": "string — o item em uma frase clara (pt-BR)",
      "assignee": "string | null — responsável, SÓ se dito explicitamente",
      "due_hint": "string | null — prazo mencionado (ex: 'até sexta'), SÓ se dito",
      "quote": "string — trecho LITERAL do transcript que sustenta o item (copie exatamente)",
      "start_ms": "number | null — start_ms do segmento da quote, se souber",
      "end_ms": "number | null",
      "speaker_label": "string | null — o SPEAKER_0X de quem disse",
      "confidence": "number — 0..1, sua confiança no item",
      "suggested_link": { "type": "objective | feature", "id": "string" } | null
    }
  ]
}`

export function composeExtractionPrompt(args: ComposeExtractionArgs): string {
  const transcript = formatTranscript(args.segments)
  const notes = args.rawNotes?.trim() || '(o usuário não escreveu notas)'

  const sections: string[] = []

  sections.push(
    [
      '## Contexto',
      'Você é um assistente que processa a transcrição de uma reunião (em pt-BR) e as notas livres do usuário, no estilo Granola: transformar a conversa em notas limpas e action items rastreáveis.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Transcript (fonte da verdade — formato `[SPEAKER @mm:ss] texto`)',
      transcript || '(transcript vazio)',
    ].join('\n'),
  )

  sections.push(['## Notas do usuário', notes].join('\n'))

  const linkSections: string[] = []
  if (args.objectives && args.objectives.length > 0) {
    linkSections.push(formatLinkables('Objetivos', args.objectives))
  }
  if (args.features && args.features.length > 0) {
    linkSections.push(formatLinkables('Features', args.features))
  }
  if (linkSections.length > 0) {
    sections.push(['## Vínculos disponíveis', ...linkSections].join('\n\n'))
  }

  sections.push(
    [
      '## Tarefa',
      '1. Reescreva as notas do usuário num documento limpo e organizado (`augmented_notes`), usando o transcript para preencher lacunas — mas SEM inventar nada que não foi dito.',
      '2. Escreva um `summary` curto e objetivo da reunião.',
      '3. Extraia os itens acionáveis (`items`): action items, decisões, feedbacks, riscos e perguntas em aberto.',
    ].join('\n'),
  )

  sections.push(
    [
      '## Restrições (grounding — anti-alucinação, OBRIGATÓRIAS)',
      '- [ ] Extraia SOMENTE o que foi efetivamente dito no transcript. Se um campo não foi dito, use `null` — NUNCA invente assignee, prazo ou speaker.',
      '- [ ] Cada item DEVE ter uma `quote` que é um trecho LITERAL copiado do transcript (sem parafrasear). Sem quote literal = não inclua o item.',
      '- [ ] Se um objetivo/feature da lista de vínculos casa claramente com o item, preencha `suggested_link`; senão, `null`. Não force vínculos.',
      '- [ ] Responda em pt-BR.',
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
