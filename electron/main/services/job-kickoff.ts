// Composição do kickoff de um Scheduled Job. Função PURA (sem I/O, sem electron),
// molde de handoff/compose-prompt.ts — trivialmente testável e importável por
// tools.ts SEM arrastar a cadeia de spawn (job-runner → ipc/sessions → electron).
//
// Uma injeção em cima do prompt do job:
//   - delta-via-prompt: se houve report na execução anterior, injeta-o pedindo a
//     classificação novo/resolvido/persistente (mitiga o "dashboard não lido").
//
// NÃO injeta mais a instrução job_report: o spawn HEADLESS (`claude -p`) não passa
// --mcp-config, então a tool era inalcançável. A captura por stdout no exit (o
// runner finaliza a JobRun direto) é o único caminho de relatório.

export interface JobKickoffParams {
  prompt: string
  // id da JobRun desta execução. Não usado na composição (a instrução job_report
  // saiu — MCP inalcançável no headless); mantido por compat com JobRunParams.
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

  return sections.join('\n\n')
}
