import { extractKeySections } from '../services/feature-memory'
import type { Feature } from '../../../shared/types/ipc'

// Conteúdo do arquivo injetado via --append-system-prompt-file no spawn de
// sessões com feature. Função pura (Feature → string) extraída de sessions.ts
// pra ser testável sem Electron/PTY. O doc é mantido automaticamente pelo
// claude-manager → instruímos a sessão a NÃO editar o doc manualmente.
export function buildFeatureContextContent(feature: Feature): string {
  const sections = extractKeySections(feature.body ?? '')
  const header = [
    `Esta sessão trabalha na feature «${feature.title}».`,
    'O claude-manager mantém este documento automaticamente — NÃO edite o doc manualmente; apenas trabalhe.',
    '',
    `Status atual: ${feature.status}`,
    feature.objective ? `Objetivo: ${feature.objective}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  // Reforço do auto-tracking (as instructions do MCP server cobrem o resto):
  // aqui a sessão ganha o featureId REAL, sem precisar resolver via feature_list.
  const tracking = `Tracking: this session's feature id is ${feature.id}. Link auto-created tasks to it (parentType "feature") and update its status via feature_update when you finish or get blocked.`
  const head = `${header}\n\n${tracking}`
  return sections ? `${head}\n\n${sections}\n` : `${head}\n`
}
