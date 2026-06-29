import type { ChatMessage } from '../../../../shared/types/ipc'

// Eco otimista de uma mensagem do usuário enviada pelo composer em modo chat. O
// transcript de disco tem atraso (o claude grava o turno do usuário no JSONL
// alguns instantes depois do submit), então mostramos a bolha na hora e a
// "reconciliamos" quando o disco alcança.
export interface Echo {
  text: string
  // Contagem de mensagens do usuário NO DISCO a partir da qual este eco é
  // considerado já gravado (e some). Contamos em vez de casar texto: assim
  // histórico com texto idêntico não resolve o eco por engano, e envios rápidos
  // em sequência não resolvem uns aos outros.
  resolveAt: number
}

// Estado de tela do Chat View. Distingue "aguardando o JSONL nascer" (sessão
// recém-spawnada, transitório — o watcher recupera quando o arquivo aparece) do
// "vazio real" (arquivo existe, 0 mensagens renderizáveis).
export type ChatViewState = 'loading' | 'waiting' | 'empty' | 'ready'

// PURA: a decisão de estado fica testável sem React. messageCount inclui ecos
// otimistas — qualquer coisa a renderar ganha de loading/waiting/empty.
export function resolveChatViewState(input: {
  loading: boolean
  transcriptExists: boolean
  messageCount: number
}): ChatViewState {
  if (input.messageCount > 0) return 'ready'
  if (input.loading) return 'loading'
  if (!input.transcriptExists) return 'waiting'
  return 'empty'
}

export function countUserMessages(messages: ChatMessage[]): number {
  let n = 0
  for (const m of messages) if (m.kind === 'user') n++
  return n
}

// resolveAt de um eco novo: resolve quando a contagem de usuário no disco chega a
// (contagem atual + ecos já pendentes + 1). O +pendingCount evita que o disco de
// um envio resolva o eco de outro envio ainda não gravado.
export function nextResolveAt(diskUserCount: number, pendingCount: number): number {
  return diskUserCount + pendingCount + 1
}

// Ecos ainda não resolvidos dada a contagem de usuário atual no disco.
export function pendingEchoes(echoes: Echo[], diskUserCount: number): Echo[] {
  return echoes.filter((e) => diskUserCount < e.resolveAt)
}

// Stick-to-bottom: só consideramos "no fim" (e portanto auto-scrollamos no
// próximo conteúdo) se a distância até o fundo está dentro de uma folga pequena.
// Folga absorve subpixels e o crescimento de uma linha em digitação.
export function isAtBottom(
  m: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = 24,
): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold
}
