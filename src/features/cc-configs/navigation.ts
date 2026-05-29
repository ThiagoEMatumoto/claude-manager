import type { ComponentTab } from './CcConfigsSidebar'

// Item focado ao navegar de um componente de plugin para a aba do seu tipo.
export interface FocusedItem {
  tab: ComponentTab
  name: string
  origin?: string
}

// Mapeia o tipo de componentRef do plugin para a aba de destino.
export const COMPONENT_TAB_BY_KIND: Record<string, ComponentTab | undefined> = {
  skills: 'skills',
  agents: 'agents',
  mcps: 'mcps',
  hooks: 'hooks',
  commands: undefined,
}
