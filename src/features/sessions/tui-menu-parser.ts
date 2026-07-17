// Parser PURO do menu interativo da TUI do claude a partir do texto plano do
// tail do buffer do xterm (readTailText no Terminal). É a fonte do "momento
// pendente" no modo chat: a CLI (2.1.212) NÃO grava o tool_use de
// AskUserQuestion/ExitPlanMode no JSONL enquanto pendente — só após a resposta —
// então o transcript nunca expõe a pergunta aberta; o buffer sim.
//
// Formato real (validação live + strings do binário; pode driftar entre versões):
//   [chip/header]
//   Pergunta em bold
//   ❯ 1. Opção A
//        descrição/wrap indentado
//     2. Opção B
//     3. Type something.        ← sentinela __other__
//     4. Chat about this        ← sentinela __chat__
//   Enter to select · ↑/↓ to navigate · Esc to cancel
//
// Menu de plano: "Would you like to proceed?" / "Exit plan mode?" com opções
// "Yes, auto-accept edits" / "Yes, manually approve edits" / "No, keep planning"
// (contagem VARIÁVEL entre versões).
//
// FAIL-CLOSED em tudo: qualquer dúvida no parse → null (a UI degrada pro banner
// "responda no terminal"). Nunca renderizar clique sobre um parse incerto.

export interface TuiMenuOption {
  // Índice 0-based da opção; o dígito exibido na TUI (e enviado no clique) é
  // index + 1 — o handler de dígito da CLI seleciona E submete.
  index: number
  label: string
  description?: string
  sentinel?: 'other' | 'chat'
}

export interface TuiMenu {
  kind: 'question' | 'plan'
  question?: string
  options: TuiMenuOption[]
  // Menu de múltipla escolha (Space to toggle): a UI degrada pra dica, sem clique.
  multiSelect: boolean
}

// Linha de opção numerada: pointer opcional (❯), UM dígito, ponto, label.
// Um dígito só: AskUserQuestion tem no máx. 4 opções + 2 sentinelas e o handler
// de dígito da CLI cobre '1'..'9'.
const OPTION_RE = /^\s*❯?\s*(\d)\.\s+(.+)$/
// Rodapé/linhas de status toleradas DEPOIS da última opção (não invalidam o menu).
const FOOTER_RE =
  /Enter to (select|confirm)|to navigate|Esc to cancel|Space to toggle|to select all|shift\+tab|ctrl\+/i
// Continuação (descrição/wrap) da última opção: indentada além do "N. ".
const CONTINUATION_RE = /^\s{3,}\S/
// Multi-pergunta (tabs + tela de revisão) fica fora do v1.
const MULTI_QUESTION_RE = /Review your answers/
// MultiSelect: rodapé de checkbox.
const MULTI_SELECT_RE = /Space to toggle/i
// Prompt de permissão (y/n de tool): também é um menu numerado, mas fica pra
// Fase 4 — responder permissão não pode passar por um card genérico de pergunta.
const PERMISSION_QUESTION_RE = /Do you want/i
const PERMISSION_OPTION_RE = /don't ask again/i
// Classificação do menu de plano (labels exatos vistos no binário da CLI).
const PLAN_QUESTION_RE = /Would you like to proceed|Exit plan mode/i
const PLAN_OPTION_RE = /^Yes, auto-accept edits|^Yes, manually approve|^No, keep planning/i

const SENTINELS: [RegExp, 'other' | 'chat'][] = [
  [/^Type something\.?$/, 'other'],
  [/^Chat about this\.?$/, 'chat'],
]

export function parseTuiMenu(text: string): TuiMenu | null {
  if (MULTI_QUESTION_RE.test(text)) return null

  const lines = text.split('\n')
  // Ignora linhas em branco no fim (o viewport abaixo do desenho da TUI).
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  if (end === 0) return null

  // Todas as linhas numeradas do tail.
  const numbered: { line: number; digit: number; rest: string }[] = []
  for (let i = 0; i < end; i++) {
    const m = OPTION_RE.exec(lines[i])
    if (m) numbered.push({ line: i, digit: Number(m[1]), rest: m[2].trim() })
  }
  if (numbered.length < 2) return null

  // Run ascendente CONTÍGUA terminando na última linha numerada — listas
  // markdown acima do menu quebram a run (o dígito não continua a sequência).
  let runStart = numbered.length - 1
  while (runStart > 0 && numbered[runStart - 1].digit === numbered[runStart].digit - 1) runStart--
  const run = numbered.slice(runStart)
  // Menu scrollado (não começa em 1) ou run de 1 item só → não é um menu íntegro.
  if (run.length < 2 || run[0].digit !== 1) return null

  // O menu precisa terminar perto do fim do texto: depois da última opção só
  // continuação indentada (descrição/wrap), branco ou rodapé. Qualquer outra
  // linha = o menu não é o elemento ativo do fundo → fail-closed.
  const last = run[run.length - 1]
  for (let i = last.line + 1; i < end; i++) {
    const l = lines[i]
    if (l.trim() === '') continue
    if (FOOTER_RE.test(l)) continue
    if (CONTINUATION_RE.test(l)) continue
    return null
  }

  // Linhas não-numeradas ENTRE opções = descrição/wrap da opção anterior.
  const options: TuiMenuOption[] = run.map((entry, k) => {
    const next = k + 1 < run.length ? run[k + 1].line : last.line + 1
    const parts: string[] = []
    for (let i = entry.line + 1; i < next; i++) {
      const t = lines[i].trim()
      if (t !== '') parts.push(t)
    }
    const sentinel = SENTINELS.find(([re]) => re.test(entry.rest))?.[1]
    return {
      index: entry.digit - 1,
      label: entry.rest,
      ...(parts.length > 0 ? { description: parts.join(' ') } : {}),
      ...(sentinel ? { sentinel } : {}),
    }
  })

  if (options.some((o) => PERMISSION_OPTION_RE.test(o.label))) return null

  // Pergunta: a linha não-branca mais próxima ACIMA da primeira opção.
  let question: string | undefined
  for (let i = run[0].line - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t !== '') {
      question = t
      break
    }
  }
  if (question && PERMISSION_QUESTION_RE.test(question)) return null

  const isPlan =
    (question != null && PLAN_QUESTION_RE.test(question)) ||
    options.some((o) => PLAN_OPTION_RE.test(o.label))

  return {
    kind: isPlan ? 'plan' : 'question',
    ...(question != null ? { question } : {}),
    options,
    multiSelect: MULTI_SELECT_RE.test(text),
  }
}

// Identidade estável de um menu parseado (pergunta + labels na ordem). Usada pra:
// (a) não re-renderizar quando o re-parse produz o mesmo menu; (b) guard de
// clique — re-parse fresco divergente do menu clicado → NÃO digitar no PTY.
export function menuFingerprint(menu: TuiMenu): string {
  return [
    menu.kind,
    menu.multiSelect ? 'multi' : 'single',
    menu.question ?? '',
    ...menu.options.map((o) => `${o.index}:${o.label}`),
    // \n como separador: nenhum campo pode conter quebra (todos vêm de split('\n')).
  ].join('\n')
}
