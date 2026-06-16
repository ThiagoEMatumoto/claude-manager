// Context-engineering do handoff cross-repo: monta o prompt PT-BR estruturado que
// a sessão-filha recebe. Função PURA (sem I/O) — toda a info chega via args, para
// ser trivialmente testável. Segue o template de prompt-templates.md do usuário
// (Contexto / Tarefa / Restrições / Reporte).

export interface HandoffEdge {
  kind: string
  label: string | null
  // 'from-mother': a aresta sai do repo-mãe (mãe → este repo).
  // 'to-mother':   a aresta entra no repo-mãe (este repo → mãe).
  direction: 'from-mother' | 'to-mother'
}

export interface ComposeHandoffArgs {
  targetRepoLabel: string
  targetRepoPath: string
  motherRepoLabel?: string
  task: string
  edges: HandoffEdge[]
  featureTitle?: string | null
  handoffId: string
}

// Frase-base por kind (verbo de relação). 'custom' e kinds desconhecidos caem no
// genérico "se relaciona com".
const KIND_PHRASE: Record<string, string> = {
  'calls-api': 'consome a API',
  'shares-types': 'compartilha tipos',
  'depends-on': 'depende de',
  'deploys-to': 'faz deploy para',
  'work-hub': 'coordena o trabalho sobre',
  infra: 'provisiona a infra de',
  monorepo: 'contém',
  documents: 'documenta',
  custom: 'se relaciona com',
}

function kindPhrase(kind: string): string {
  return KIND_PHRASE[kind] ?? KIND_PHRASE.custom
}

// Descreve UMA aresta em linguagem natural, orientada pela direção. A direção diz
// quem é o sujeito: from-mother => o repo-mãe é o sujeito; to-mother => este repo
// é o sujeito.
function describeEdge(edge: HandoffEdge, motherLabel: string, targetLabel: string): string {
  const phrase = kindPhrase(edge.kind)
  const sentence =
    edge.direction === 'from-mother'
      ? `o repo ${motherLabel} ${phrase} este repo (${targetLabel})`
      : `este repo (${targetLabel}) ${phrase} o repo ${motherLabel}`
  return edge.label ? `${sentence} — ${edge.label}` : sentence
}

export function composeHandoffPrompt(args: ComposeHandoffArgs): string {
  const motherLabel = args.motherRepoLabel ?? 'origem'

  const contextLines: string[] = [
    '## Contexto',
    `Trabalho end-to-end vindo do repo ${motherLabel}; relação com este repo:`,
  ]
  for (const edge of args.edges) {
    contextLines.push(`- ${describeEdge(edge, motherLabel, args.targetRepoLabel)}`)
  }
  if (args.featureTitle) {
    contextLines.push(`- Feature relacionada: ${args.featureTitle}`)
  }

  const restricoes = [
    '## Restrições',
    `- [ ] Investigar/implementar SOMENTE neste repo (${args.targetRepoLabel}, ${args.targetRepoPath}).`,
    '- [ ] Se algo não está no código real, diga "não encontrado" em vez de inferir.',
    '- [ ] Não fazer git push nem criar PR sem pedido explícito.',
  ]

  const reporte = [
    '## Reporte',
    `Ao terminar, chame a MCP tool \`handoff_report\` com handoffId="${args.handoffId}" e um resumo de até 250 palavras (descoberta principal + arquivos tocados + próximo passo recomendado). NÃO cole código longo no resumo.`,
  ]

  return [
    contextLines.join('\n'),
    ['## Tarefa', args.task].join('\n'),
    restricoes.join('\n'),
    reporte.join('\n'),
  ].join('\n\n')
}
