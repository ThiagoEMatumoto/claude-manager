// Composição do kickoff de um Scheduled Job. Função PURA (sem I/O, sem electron),
// molde de handoff/compose-prompt.ts — trivialmente testável e importável por
// tools.ts SEM arrastar a cadeia de spawn (job-runner → ipc/sessions → electron).
//
// Duas injeções em cima do prompt do job:
//   1. delta-via-prompt: se houve report na execução anterior, injeta-o pedindo a
//      classificação novo/resolvido/persistente (mitiga o "dashboard não lido").
//   2. job_report: instrui a sessão a fechar com a tool MCP job_report(runId) —
//      push estruturado OPCIONAL; a captura pull no exit (Fase 2) é o piso.

export interface JobKickoffParams {
  prompt: string
  // id da JobRun desta execução — vira o alvo do job_report na instrução final.
  runId?: string | null
  // report_text da execução ANTERIOR (null/vazio no 1º run → bloco omitido).
  previousReport?: string | null
}

export function composeJobKickoff(params: JobKickoffParams): string {
  const sections: string[] = [params.prompt]

  const previous = params.previousReport?.trim()
  if (previous) {
    sections.push(
      [
        '## Relatório da execução anterior',
        'Abaixo está o relatório da última execução deste job. Ao produzir o novo relatório,',
        'classifique cada ponto como **novo**, **resolvido** ou **persistente**, e destaque regressões.',
        '',
        previous,
      ].join('\n'),
    )
  }

  if (params.runId) {
    sections.push(
      [
        '## Ao terminar',
        `Quando o trabalho estiver concluído, chame a tool \`job_report\` com runId="${params.runId}"`,
        'e o relatório final em markdown (achados + sugestões). Isso registra o resultado desta execução.',
      ].join('\n'),
    )
  }

  return sections.join('\n\n')
}
