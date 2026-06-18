// Context-engineering do handoff cross-repo: monta o prompt PT-BR estruturado que
// a sessão-filha recebe. Função PURA (sem I/O) — toda a info chega via args, para
// ser trivialmente testável. Segue o template de prompt-templates.md do usuário
// (Contexto / Tarefa / Restrições / Reporte).

import { describeEdge, type KindEdge } from '../architecture/kind-phrase'
import type { HandoffMode } from '../../../../shared/types/ipc'

// HandoffEdge é a aresta orientada ao repo-mãe (ver KindEdge no módulo compartilhado).
//   'from-mother': a aresta sai do repo-mãe (mãe → este repo).
//   'to-mother':   a aresta entra no repo-mãe (este repo → mãe).
export type HandoffEdge = KindEdge

export interface ComposeHandoffArgs {
  targetRepoLabel: string
  targetRepoPath: string
  motherRepoLabel?: string
  task: string
  edges: HandoffEdge[]
  featureTitle?: string | null
  handoffId: string
  // Modo de permissão com que a filha sobe — molda as restrições do prompt.
  mode?: HandoffMode
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
  if (args.mode === 'plan') {
    restricoes.push(
      '- [ ] Você está em PLAN MODE (read-only): investigue e proponha, NÃO edite arquivos.',
    )
  } else if (args.mode === 'auto-edits') {
    restricoes.push(
      '- [ ] Modo auto-edits: edições são aplicadas automaticamente; comandos destrutivos (rm, git push/reset --hard, force push) estão bloqueados.',
    )
  }

  const reporte = [
    '## Reporte',
    `- Chame \`handoff_progress\` com handoffId="${args.handoffId}" e um \`step\` curto ao longo do trabalho (ex.: "mapeando handlers", "rodando testes") — assim a mãe acompanha o andamento.`,
    `- Só chame \`handoff_report\` (handoffId="${args.handoffId}") quando o trabalho estiver REALMENTE concluído E verificado (testes/typecheck passando). "done" significa done — não reporte antes de terminar.`,
    '- O resumo do report: até 250 palavras (descoberta principal + arquivos tocados + próximo passo). NÃO cole código longo.',
  ]

  return [
    contextLines.join('\n'),
    ['## Tarefa', args.task].join('\n'),
    restricoes.join('\n'),
    reporte.join('\n'),
  ].join('\n\n')
}
