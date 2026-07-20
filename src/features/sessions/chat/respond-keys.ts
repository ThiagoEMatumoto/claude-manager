import type { TuiMenu } from '../tui-menu-parser'

// Tradução dos cliques nos cards interativos do chat (QuestionCard/PlanCard) em
// teclas pro PTY vivo — o mesmo canal write() usado pelo onForwardKey do composer.
//
// Achados de validação LIVE (claude 2.1.212) + strings do binário:
// - O handler de dígitos da TUI (key >= '1' && key <= '9') seleciona E SUBMETE a
//   opção N — confirmado ao vivo (<1,5s, sem Enter). Por isso a resposta é UM
//   dígito, imune ao drift de highlight que tornava setas+Enter frágeis (se o
//   usuário já navegou no menu pelo terminal, o highlight não está no topo).
// - ExitPlanMode: a CONTAGEM e a ORDEM das opções variam entre versões/modos
//   (ultraplan/bypass). Aprovar NUNCA usa Enter cego — o highlight inicial pode
//   ser "Yes, auto-accept edits", que muda o modo de permissão. Só aprovamos via
//   dígito da opção de aprovação MANUAL parseada do buffer; sem match, a UI nem
//   renderiza o botão. Esc rejeita de qualquer posição.
// - A fonte do menu é o parse do buffer do xterm (tui-menu-parser): a CLI não
//   grava o tool_use pendente no JSONL, então o transcript não expõe o momento.

// Um clique numa opção vira o dígito dela (1-based na TUI; index aqui é 0-based).
// Fora do range coberto pelo handler da TUI ('1'..'9') → [] (nunca digitar).
export function buildDigitKey(index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index > 8) return []
  return [String(index + 1)]
}

// Clique numa opção de menu single-select (com ou sem preview). Catálogo
// validado ao vivo (claude 2.1.215): sem preview o dígito já seleciona E
// submete (comportamento pré-existente, preservado); COM preview/notes o
// dígito só move o cursor — precisa de Enter separado, senão a opção fica
// destacada mas nada é enviado.
export function buildSelectKeys(menu: TuiMenu, optionIndex: number): string[] {
  const digit = buildDigitKey(optionIndex)
  if (digit.length === 0) return []
  return menu.submitOnDigit ? digit : [...digit, '\r']
}

// Clique num checkbox de multi-select: dígito faz TOGGLE (marca/desmarca),
// NUNCA submete — validado ao vivo (repetido: '1' marca, '1' de novo
// desmarca, sem sair da tela). Submeter de fato só na aba "Submit" → tela de
// revisão (ver buildReviewKeys). Alias de buildDigitKey só pra deixar a
// intenção explícita nos call sites (toggle ≠ select).
export function buildToggleKeys(optionIndex: number): string[] {
  return buildDigitKey(optionIndex)
}

// Navegação entre abas da barra de multi-pergunta/multi-select — setas
// esquerda/direita, validado ao vivo (`\x1b[C`/`\x1b[D`). Nunca dígito nem
// Enter: trocar de aba não marca nem submete nada.
export function buildTabKeys(direction: 'next' | 'prev'): string[] {
  return [direction === 'next' ? '\x1b[C' : '\x1b[D']
}

// Opções da tela de revisão ("Review your answers") pelo LABEL exato do
// binário — nunca por posição fixa (a ordem/contagem pode variar em teoria,
// mesma cautela de findManualApproveIndex).
const REVIEW_SUBMIT_RE = /^Submit answers$/i
const REVIEW_CANCEL_RE = /^Cancel$/i

export function findReviewOptionIndex(
  menu: TuiMenu,
  decision: 'submit' | 'cancel',
): number | null {
  if (menu.kind !== 'question_review') return null
  const re = decision === 'submit' ? REVIEW_SUBMIT_RE : REVIEW_CANCEL_RE
  const opt = menu.options.find((o) => re.test(o.label))
  return opt ? opt.index : null
}

// Submete (dígito '1' = "Submit answers") ou cancela ('2' = "Cancel") a
// revisão final do multi-select/multi-pergunta — validado ao vivo. Sem a
// opção parseada (kind errado ou labels mudaram) → [] (fail-closed).
export function buildReviewKeys(menu: TuiMenu, decision: 'submit' | 'cancel'): string[] {
  const idx = findReviewOptionIndex(menu, decision)
  return idx == null ? [] : buildDigitKey(idx)
}

// "Other" (texto livre): dígito seleciona a linha (não abre input, não
// submete), o texto digitado reescreve a label inline, Enter confirma —
// validado ao vivo. Armadilha confirmada: Enter com o campo vazio é lido
// pela TUI como "declinou responder" — por isso texto vazio nunca manda
// Enter (retorna [], fail-closed).
export function buildOtherKeys(optionIndex: number, text: string): string[] {
  if (text === '') return []
  const digit = buildDigitKey(optionIndex)
  if (digit.length === 0) return []
  return [...digit, text, '\r']
}

// Opção de aprovação MANUAL no menu de plano parseado. Prefixo estrito: não pode
// casar "Yes, auto-accept edits" (evidência dos labels no binário da CLI).
const MANUAL_APPROVE_RE = /^Yes, manually approve/i

export function findManualApproveIndex(menu: TuiMenu): number | null {
  if (menu.kind !== 'plan') return null
  const opt = menu.options.find((o) => MANUAL_APPROVE_RE.test(o.label))
  return opt ? opt.index : null
}

// Decide um ExitPlanMode: aprovar = dígito da opção de aprovação manual (null =
// não encontrada → [] e a UI não oferece o botão); rejeitar = Esc, que cancela
// de qualquer posição do highlight.
export function buildPlanKeys(
  d: 'approve' | 'reject',
  manualApproveIndex: number | null,
): string[] {
  if (d === 'reject') return ['\x1b']
  return manualApproveIndex == null ? [] : buildDigitKey(manualApproveIndex)
}

// Reproduz as sequências no PTY com um respiro entre elas: a TUI (Ink) processa
// chunks sequencialmente e escapes colados num chunk só podem colapsar num único
// evento de tecla. `sleep` injetável mantém o módulo puro e o teste síncrono.
export async function playKeys(
  seqs: string[],
  write: (s: string) => void,
  delayMs = 30,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let i = 0; i < seqs.length; i++) {
    if (i > 0) await sleep(delayMs)
    write(seqs[i])
  }
}
