import { NAV_SEQ } from '../composer-keys'

// Tradução dos cliques nos cards interativos do chat (QuestionCard/PlanCard) em
// teclas pro PTY vivo — o mesmo canal write() usado pelo onForwardKey do composer.
//
// Achados do binário da CLI do claude (engenharia reversa; podem driftar entre
// versões — validar ao vivo antes de evoluir):
// - AskUserQuestion: o highlight inicial é a PRIMEIRA opção; as sentinelas
//   "__other__"/"__chat__" (Other / Chat about this) ficam DEPOIS das opções —
//   navegar N× pra baixo a partir do topo seleciona a opção N com segurança.
// - Existe handler de dígitos (key >= '1' && key <= '9') que seleciona o índice,
//   mas a semântica selecionar-vs-submeter NÃO foi confirmada ao vivo; por isso a
//   V1 usa setas+Enter e a troca por dígitos fica pra depois da validação live.
// - Multi-pergunta tem tabs + tela "Review your answers" → V1 não torna clicável.
// - ExitPlanMode: a contagem de opções do menu VARIA entre versões da CLI → NUNCA
//   usar setas nesse menu. Enter aprova (highlight inicial = Yes) e Esc rejeita
//   independente da posição do highlight.
// - Risco de drift: se o usuário já navegou no menu pelo TERMINAL, o highlight não
//   está mais no topo e as sequências abaixo podem selecionar a opção errada. O
//   guard de status/pending do ChatView reduz mas não elimina esse risco.

// Seleciona a opção `optionIndex` de um AskUserQuestion: desce N vezes a partir do
// highlight inicial (opção 0) e confirma com Enter.
export function buildQuestionKeys(optionIndex: number): string[] {
  const seqs: string[] = []
  for (let i = 0; i < optionIndex; i++) seqs.push(NAV_SEQ.ArrowDown)
  seqs.push('\r')
  return seqs
}

// Decide um ExitPlanMode: Enter aprova (highlight inicial = Yes); Esc rejeita de
// qualquer posição. Sem setas — ver nota sobre contagem variável no header.
export function buildPlanKeys(d: 'approve' | 'reject'): string[] {
  return d === 'approve' ? ['\r'] : ['\x1b']
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
