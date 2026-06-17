// Vocabulário compartilhado para descrever arestas do grafo de arquitetura em
// linguagem natural PT-BR. Usado pelo handoff cross-repo (compose-prompt) e pelo
// bloco de arquitetura injetado no spawn de sessões. Módulo PURO (sem I/O).

// Frase-base por kind (verbo de relação). 'custom' e kinds desconhecidos caem no
// genérico "se relaciona com".
export const KIND_PHRASE: Record<string, string> = {
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

export function kindPhrase(kind: string): string {
  return KIND_PHRASE[kind] ?? KIND_PHRASE.custom
}

// Direção orientada ao repo-mãe (usada pelo handoff):
//   'from-mother' => a mãe é o sujeito (mãe → este repo).
//   'to-mother'   => este repo é o sujeito (este repo → mãe).
export interface KindEdge {
  kind: string
  label: string | null
  direction: 'from-mother' | 'to-mother'
}

// Descreve UMA aresta em linguagem natural, orientada pela direção. A direção diz
// quem é o sujeito: from-mother => o repo-mãe é o sujeito; to-mother => este repo
// é o sujeito.
export function describeEdge(
  edge: KindEdge,
  motherLabel: string,
  targetLabel: string,
): string {
  const phrase = kindPhrase(edge.kind)
  const sentence =
    edge.direction === 'from-mother'
      ? `o repo ${motherLabel} ${phrase} este repo (${targetLabel})`
      : `este repo (${targetLabel}) ${phrase} o repo ${motherLabel}`
  return edge.label ? `${sentence} — ${edge.label}` : sentence
}
