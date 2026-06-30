import type { PermissionMode } from '../../../shared/types/ipc'

// Indicadores que a TUI do Claude Code imprime no rodapé quando um modo de
// permissão está ativo. A negative lookbehind em "accept edits on" evita que
// ele case DENTRO de "auto-accept edits on" (senão o modo 'auto' seria lido
// como 'acceptEdits'). 'default' e 'dontAsk' não têm indicador próprio no
// rodapé — caem no null (caller mantém o anterior).
const MODE_INDICATORS: { re: RegExp; mode: PermissionMode }[] = [
  { re: /(?<!auto-)accept edits on/gi, mode: 'acceptEdits' },
  { re: /plan mode on/gi, mode: 'plan' },
  { re: /(auto-accept edits|auto mode) on/gi, mode: 'auto' },
  { re: /bypass(ing)? permissions/gi, mode: 'bypassPermissions' },
]

// Varre o texto acumulado do PTY pelo indicador de modo MAIS RECENTE (a
// ocorrência mais à direita = o último rodapé renderizado) e retorna o
// PermissionMode correspondente. Retorna null quando nenhum indicador aparece
// — o caller mantém o modo anterior/default. Puro e testável (sem React/estado).
export function parsePermissionMode(text: string): PermissionMode | null {
  let bestIndex = -1
  let bestMode: PermissionMode | null = null
  for (const { re, mode } of MODE_INDICATORS) {
    re.lastIndex = 0
    let lastIndex = -1
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      lastIndex = match.index
    }
    if (lastIndex > bestIndex) {
      bestIndex = lastIndex
      bestMode = mode
    }
  }
  return bestMode
}
