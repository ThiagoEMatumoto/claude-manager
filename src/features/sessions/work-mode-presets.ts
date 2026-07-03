import type { AdvisorModel, EffortLevel, PermissionMode } from '../../../shared/types/ipc'

// Presets fixos e curados de "modo de trabalho" (v1: sem CRUD). Dado puro —
// SpawnSessionDialog aplica os campos ao selecionar; o usuário ainda pode
// ajustar cada controle manualmente depois (mesmo espírito do pré-preenchimento
// de defaults persistidos já existente). Campos ausentes = sem override (usa o
// default/vazio do próprio dialog).
export interface WorkModePreset {
  id: string
  label: string
  description: string
  model?: string
  effort?: EffortLevel
  permission?: PermissionMode
  advisorModel?: AdvisorModel
  // Slash command injetado no boot da sessão (bracketed-paste), ex.: '/effort ultracode'.
  initialCommand?: string
}

export const WORK_MODE_PRESETS: WorkModePreset[] = [
  {
    id: 'default',
    label: 'Padrão',
    description: 'Sem overrides — usa os defaults de Configurações.',
  },
  {
    id: 'opus-plan',
    label: 'Opus Plan',
    description: 'Opus no plan mode, troca pra Sonnet ao sair pra execução.',
    model: 'opusplan',
  },
  {
    id: 'consultor',
    label: 'Consultor',
    description: 'Liga o advisor tool (segunda opinião do Opus em pontos-chave).',
    advisorModel: 'opus',
  },
  {
    id: 'ultracode',
    label: 'Ultracode',
    description: 'Esforço xhigh + orquestração dinâmica via Workflow tool.',
    effort: 'xhigh',
    initialCommand: '/effort ultracode',
  },
]
