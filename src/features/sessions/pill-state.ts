import { Gauge, ShieldAlert, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'
import type { PermissionMode } from '../../../shared/types/ipc'
import type { EffortLevel } from './ModelPill'

// Helper compartilhado de cor-por-estado dos pills (EffortPill/PermissionPill).
// Fonte ÚNICA pra manter a fiação visual coesa: cada estado mapeia pra uma
// classe Tailwind de cor de texto + o token CSS var() cru (pra ícone/borda) +
// um ícone lucide representativo.

export interface PillStyle {
  /** Classe(s) Tailwind de cor de texto (inclui peso quando o estado é "forte"). */
  text: string
  /** Token CSS var() correspondente — útil pra colorir ícone/borda inline. */
  color: string
  /** Ícone lucide representativo do estado. */
  icon: LucideIcon
}

// 'ultracode' NÃO é um valor de --effort (mecanismo nativo via /effort ultracode),
// mas compartilha o seletor visual do EffortPill, então entra no domínio de cor aqui.
export type EffortStyleLevel = EffortLevel | 'ultracode'

export function effortStyle(level: EffortStyleLevel): PillStyle {
  switch (level) {
    case 'low':
      return { text: 'text-[var(--color-text-dim)]', color: 'var(--color-text-dim)', icon: Gauge }
    case 'medium':
      return { text: 'text-[var(--color-text)]', color: 'var(--color-text)', icon: Gauge }
    case 'high':
      return { text: 'text-[var(--color-accent)]', color: 'var(--color-accent)', icon: Gauge }
    case 'xhigh':
      return { text: 'font-semibold text-[var(--color-accent)]', color: 'var(--color-accent)', icon: Gauge }
    case 'max':
      return { text: 'font-semibold text-[var(--color-warning)]', color: 'var(--color-warning)', icon: Gauge }
    case 'ultracode':
      return { text: 'font-semibold text-[var(--color-violet)]', color: 'var(--color-violet)', icon: Sparkles }
  }
}

// default/plan = seguro (cor normal, ShieldCheck); acceptEdits = aviso (âmbar,
// ShieldCheck); auto/bypassPermissions/dontAsk = perigo (vermelho, ShieldAlert).
// null = ainda não detectado no rodapé da TUI → trata como o padrão seguro.
export function permissionStyle(mode: PermissionMode | null): PillStyle {
  switch (mode) {
    case 'acceptEdits':
      return { text: 'text-[var(--color-warning)]', color: 'var(--color-warning)', icon: ShieldCheck }
    case 'auto':
    case 'bypassPermissions':
    case 'dontAsk':
      return { text: 'text-[var(--color-danger)]', color: 'var(--color-danger)', icon: ShieldAlert }
    case 'default':
    case 'plan':
    case null:
      return { text: 'text-[var(--color-text)]', color: 'var(--color-text)', icon: ShieldCheck }
  }
}
