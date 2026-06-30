// Monta os bytes de um prompt do composer pro PTY. Normaliza quebras de linha pra
// \r (o TUI do claude trata \r como Enter) e, quando o bracketed-paste do terminal
// está ativo, envolve em \x1b[200~…\x1b[201~ pra que o conteúdo entre os marcadores
// seja colado literalmente — os \r internos NÃO submetem. O \r final que submete é
// do caller (sendPrompt), não daqui. Espelha o formato canônico de
// electron/main/services/handoff/inject.ts.
export function buildPromptBytes(text: string, bracketed: boolean): string {
  const normalized = text.replace(/\r?\n/g, '\r')
  return bracketed ? `\x1b[200~${normalized}\x1b[201~` : normalized
}
