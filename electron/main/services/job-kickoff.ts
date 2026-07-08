import type { JobKind, JobMetrics } from '../../../shared/types/ipc'

// Composição do kickoff de um Scheduled Job. Função PURA (sem I/O, sem electron),
// molde de handoff/compose-prompt.ts — trivialmente testável e importável por
// tools.ts SEM arrastar a cadeia de spawn (job-runner → ipc/sessions → electron).
//
// Duas injeções em cima do prompt do job:
//   - web-audit: quando kind === 'web-audit', injeta o playbook de auditoria de
//     browser (baseado na skill browser-validate) + a targetUrl + a instrução de
//     login (lê as credenciais do env via printenv, SEM ecoá-las) + o formato de
//     saída (relatório markdown + bloco JSON de métricas que a Fase 2 vai parsear).
//   - delta-via-prompt: se houve report na execução anterior, injeta-o pedindo a
//     classificação novo/resolvido/persistente (mitiga o "dashboard não lido").
//
// NÃO injeta a instrução job_report: o spawn HEADLESS (`claude -p`) não passa
// --mcp-config, então a tool era inalcançável. A captura por stdout no exit (o
// runner finaliza a JobRun direto) é o único caminho de relatório.

export interface JobKickoffParams {
  prompt: string
  // Tipo do job. 'web-audit' injeta o playbook de browser; qualquer outro valor
  // (incl. null/'critique') mantém o kickoff atual (só prompt + delta).
  kind?: JobKind | null
  // URL auditada (só web-audit). Vazia/null → o playbook instrui a sessão a pedir
  // a URL ao operador (não deveria ocorrer: a UI/MCP exige targetUrl no web-audit).
  targetUrl?: string | null
  // id da JobRun desta execução. Não usado na composição (a instrução job_report
  // saiu — MCP inalcançável no headless); mantido por compat com JobRunParams.
  runId?: string | null
  // report_text da execução ANTERIOR (null/vazio no 1º run → bloco omitido).
  previousReport?: string | null
  // metrics_json (string JSON crua de getLastMetrics) da execução ANTERIOR — só
  // web-audit. Injeta a tendência de métricas no kickoff. null/vazio/inválido →
  // bloco omitido (best-effort, molde do previousReport).
  previousMetrics?: string | null
}

// Formata as métricas da execução anterior (string JSON crua) numa linha legível
// pro modelo comparar. Tolerante: JSON inválido → null (bloco omitido). Métrica
// null vira 'n/d' (não medida na run anterior).
function formatPreviousMetrics(json: string): string | null {
  let m: Partial<JobMetrics> | null
  try {
    m = JSON.parse(json) as Partial<JobMetrics>
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  const n = (v: unknown, unit = ''): string =>
    typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : 'n/d'
  return [
    '## Métricas da execução anterior',
    `LCP=${n(m.lcp, 'ms')}, TTFB=${n(m.ttfb, 'ms')}, ` +
      `erros de console=${n(m.consoleErrors)}, falhas de rede=${n(m.networkFailures)}.`,
    'Meça as MESMAS métricas nesta execução e destaque regressões (piora) ou melhorias vs os valores acima.',
  ].join('\n')
}

// Nomes das env vars de login do legal-ui, resolvidos DETERMINISTICAMENTE pela
// targetUrl (o modelo não infere qual ler). Domínios: staging = legalstaging,
// prod = app.legal.lexter.ai. Ambíguo/desconhecido → STAGING (fail toward non-prod:
// nunca escolhe prod por engano). As vars chegam ao processo via spawnEnv (feature
// de Env do app); o playbook só referencia os NOMES, nunca os valores.
function resolveLegalUiCreds(targetUrl: string | null | undefined): {
  envLabel: 'STAGING' | 'PROD'
  usernameVar: string
  passwordVar: string
} {
  const url = (targetUrl ?? '').toLowerCase()
  const isProd = url.includes('legal.lexter.ai') && !url.includes('legalstaging')
  const envLabel = isProd ? 'PROD' : 'STAGING'
  return {
    envLabel,
    usernameVar: `LEGAL_UI_${envLabel}_USERNAME`,
    passwordVar: `LEGAL_UI_${envLabel}_PASSWORD`,
  }
}

// Snippet de timing (skill browser-validate). Passado ao browser_evaluate depois da
// página estabilizar → TTFB / DOMContentLoaded / load / LCP.
const TIMING_SNIPPET = `() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const lcp = performance.getEntriesByType('largest-contentful-paint').slice(-1)[0];
  return {
    ttfb: Math.round(nav.responseStart || 0),
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    lcp: lcp ? Math.round(lcp.startTime) : null,
  };
}`

function webAuditPlaybook(targetUrl: string | null | undefined): string {
  const url = targetUrl?.trim() || '(URL não informada — peça ao operador antes de prosseguir)'
  const { envLabel, usernameVar, passwordVar } = resolveLegalUiCreds(targetUrl)
  return [
    '## Playbook de auditoria web (browser)',
    '',
    'Você é um auditor de **desempenho** e **usabilidade** web. Dirija um browser REAL',
    '(Playwright) contra a URL alvo e produza um relatório com evidência concreta. As tools',
    '`browser_*` do Playwright estão liberadas para este job.',
    '',
    '**Execute as tools `browser_*` VOCÊ MESMO nesta sessão.** NÃO delegue a sub-agentes',
    '(Agent/Task) nem invoque skills/agentes de QA: um sub-agente NÃO herda as browser tools',
    'deste job e a auditoria falha. Faça login, navegue, meça e escreva o relatório aqui.',
    '',
    `**URL alvo:** ${url}`,
    '',
    `### 1. Login (ambiente: ${envLabel})`,
    'Se a URL cair numa tela de login (legal-ui / Firebase email+senha), autentique.',
    'As credenciais estão no ambiente do processo — leia-as via Bash `printenv` e **NUNCA**',
    'as ecoe no relatório, no snapshot, no screenshot ou em qualquer output:',
    `- Usuário: valor de \`printenv ${usernameVar}\``,
    `- Senha: valor de \`printenv ${passwordVar}\``,
    '',
    'Fluxo:',
    '- `browser_navigate` para a URL alvo.',
    '- Se cair em `/login`: `browser_type` o usuário em `[data-testid=email-input]`,',
    '  `browser_type` a senha em `[data-testid=password-input]`, `browser_click` em',
    '  `[data-testid=login-button]`, e `browser_wait_for` a URL casar `**/app/**`.',
    '',
    '### 2. Navegue e estabilize',
    '`browser_navigate` até a rota alvo e `browser_wait_for` um elemento conhecido do',
    '`browser_snapshot` (não um sleep fixo). Só meça DEPOIS de confirmar que a URL final',
    'casa `**/app/**` (página autenticada) — nunca meça a performance em `/login`.',
    '',
    '### 3. Capture evidência (rode TODAS)',
    '- `browser_snapshot` — árvore de acessibilidade; confirme que o conteúdo esperado renderizou.',
    '- `browser_take_screenshot` — artefato visual.',
    '- `browser_console_messages` — mantenha só `error`/`warning`.',
    '- `browser_network_requests` — sinalize `4xx`/`5xx`/falhas.',
    '- `browser_evaluate` com o snippet de timing abaixo (após a página estabilizar):',
    '',
    '```js',
    TIMING_SNIPPET,
    '```',
    '',
    '### 4. Relatório (markdown)',
    'Produza um relatório em markdown com DUAS seções:',
    '- **Desempenho:** LCP, TTFB, load, erros de console (liste), requests falhos (método/url/status).',
    '- **Usabilidade:** avalie por heurísticas (visibilidade de estado do sistema, consistência,',
    '  prevenção de erro, hierarquia visual, acessibilidade do snapshot) — achados + sugestões.',
    '',
    'Ao FINAL do relatório, emita um bloco de código ` ```json ` EXATAMENTE com estas chaves',
    '(números; `null` se não medido) — a captura de métricas depende dele:',
    '',
    '```json',
    '{"lcp": <ms|null>, "ttfb": <ms|null>, "consoleErrors": <n>, "networkFailures": <n>}',
    '```',
    '',
    '**REGRA DE SEGURANÇA:** NUNCA escreva as credenciais (usuário/senha) no relatório, no',
    'snapshot, no screenshot ou em qualquer output. Elas só existem no ambiente do processo.',
  ].join('\n')
}

export function composeJobKickoff(params: JobKickoffParams): string {
  const sections: string[] = [params.prompt]

  if (params.kind === 'web-audit') {
    sections.push(webAuditPlaybook(params.targetUrl))
    const prevMetrics = params.previousMetrics?.trim()
    if (prevMetrics) {
      const block = formatPreviousMetrics(prevMetrics)
      if (block) sections.push(block)
    }
  }

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
