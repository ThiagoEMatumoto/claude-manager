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
